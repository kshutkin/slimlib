//@ts-nocheck
/**
 * Browser-side bench harness.
 *
 * Bundles tests/benchmark-mitata.mjs (plus all adapter libs) with esbuild,
 * serves the bundle over an ephemeral http server, launches headless
 * Chromium via playwright, forwards page console output to stdout, and
 * waits for the "[bench-done]" sentinel before shutting everything down.
 *
 * If the chromium binary is missing, run:  npx playwright install chromium
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Parse CSV into Map<test, Map<lib, {mean, variance, n}>>
function parseCSV(content) {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return new Map();
    const header = lines[0].split(',');
    const fwNames = header
        .slice(1)
        .filter((_, i) => i % 3 === 0)
        .map(n => n.replace('_mean', ''));
    const data = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const testName = cols[0];
        const testData = new Map();
        for (let j = 0; j < fwNames.length; j++) {
            const meanVal = parseFloat(cols[1 + j * 3]) || 0;
            const varVal = parseFloat(cols[2 + j * 3]) || 0;
            const nVal = parseInt(cols[3 + j * 3], 10) || 1;
            testData.set(fwNames[j], { mean: meanVal, variance: varVal, n: nVal });
        }
        data.set(testName, testData);
    }
    return data;
}

// Welch's t-test approximation, alpha=0.05 two-tailed.
function isSignificant(m1, v1, n1, m2, v2, n2) {
    if (n1 < 2 || n2 < 2) return false;
    if (v1 === 0 && v2 === 0) return m1 !== m2;
    const se = Math.sqrt(v1 / n1 + v2 / n2);
    if (se === 0) return m1 !== m2;
    const t = Math.abs(m1 - m2) / se;
    const num = (v1 / n1 + v2 / n2) ** 2;
    const denom = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
    const df = denom > 0 ? num / denom : 1;
    const z = 1.96;
    const tCrit = z + (z * z * z + z) / (4 * df);
    return t > tCrit;
}

import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';

const outDir = new URL('../.bench-browser/', import.meta.url);
await mkdir(outDir, { recursive: true });

const entryPath = fileURLToPath(new URL('./benchmark-mitata.mjs', import.meta.url));
const bundlePath = fileURLToPath(new URL('./bundle.mjs', outDir));
const htmlPath = fileURLToPath(new URL('./index.html', outDir));

console.log('[bench-browser] bundling...');
await build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    logLevel: 'warning',
    // mitata reaches for these runtime-detection modules transitively; stub
    // them out so the browser bundle never faults on a node/bun-only dep.
    external: ['bun:jsc', 'node:os', 'node:v8', 'node:process'],
    plugins: [sveltePlugin({ compilerOptions: { runes: true } })],
});

await writeFile(
    htmlPath,
    `<!doctype html>
<meta charset="utf-8"><title>bench</title>
<body>
<script type="importmap">
{ "imports": {
  "bun:jsc":   "data:text/javascript,export const memoryUsage = () => ({});",
  "node:os":   "data:text/javascript,export default {};",
  "node:v8":   "data:text/javascript,export default {};",
  "node:process": "data:text/javascript,export default {};"
} }
</script>
<script type="module" src="./bundle.mjs"></script>
</body>
`
);

const mime = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json',
};

const server = createServer(async (req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url;
    try {
        const buf = await readFile(new URL('.' + url, outDir));
        res.writeHead(200, { 'content-type': mime[extname(url)] ?? 'application/octet-stream' });
        res.end(buf);
    } catch {
        res.writeHead(404).end();
    }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;
console.log(`[bench-browser] serving on http://127.0.0.1:${port}/`);

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch (err) {
    console.error('[bench-browser] failed to load playwright: ' + err.message);
    console.error('  install it with:  pnpm i -D playwright');
    server.close();
    process.exit(1);
}

let browser;
try {
    browser = await chromium.launch({
        headless: true,
        args: ['--js-flags=--expose-gc'],
    });
} catch (err) {
    console.error('[bench-browser] failed to launch chromium: ' + err.message);
    console.error('  download the browser with:  npx playwright install chromium');
    server.close();
    process.exit(1);
}

const page = await browser.newPage();

let done = false;
let benchResultsPayload = null;
const BENCH_RESULTS_PREFIX = '[bench-results] ';
page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith(BENCH_RESULTS_PREFIX)) {
        try {
            benchResultsPayload = JSON.parse(text.slice(BENCH_RESULTS_PREFIX.length));
        } catch (err) {
            process.stderr.write(`[bench-browser] failed to parse bench-results JSON: ${err.message}\n`);
        }
        return;
    }
    process.stdout.write(text + '\n');
    if (text.includes('[bench-done]')) done = true;
});
page.on('pageerror', err => {
    process.stderr.write('PAGE ERROR: ' + (err.stack || err.message) + '\n');
});

await page.goto(`http://127.0.0.1:${port}/`);

const deadline = Date.now() + 15 * 60_000;
while (!done && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
}

await browser.close();
server.close();

if (!done) {
    console.error('[bench-browser] bench did not complete within 15 minutes');
    process.exit(1);
}

if (benchResultsPayload?.csv) {
    const csvPath = fileURLToPath(new URL('../results-browser.csv', import.meta.url));
    const sc = benchResultsPayload.scenarioCount ?? '?';
    const lc = benchResultsPayload.libOrder?.length ?? '?';
    const fileExists = existsSync(csvPath);

    if (fileExists) {
        const existingContent = await readFile(csvPath, 'utf-8');
        const existingData = parseCSV(existingContent);
        const currentData = parseCSV(benchResultsPayload.csv);

        console.log('');
        console.log('='.repeat(70));
        console.log('Statistically Significant Changes');
        console.log('='.repeat(70));
        console.log('');

        let hasSignificantChanges = false;
        for (const [testName, testStats] of currentData) {
            const existingTest = existingData.get(testName);
            if (!existingTest) {
                console.log(`  NEW: ${testName}`);
                hasSignificantChanges = true;
                continue;
            }
            for (const [fwName, cur] of testStats) {
                const prev = existingTest.get(fwName);
                if (!prev) continue;
                if (cur.mean === 0 && cur.n === 0) continue;
                if (prev.mean === 0 && prev.n === 0) continue;
                if (isSignificant(cur.mean, cur.variance, cur.n, prev.mean, prev.variance, prev.n)) {
                    hasSignificantChanges = true;
                    const diff = cur.mean - prev.mean;
                    const pct = prev.mean !== 0 ? ((diff / prev.mean) * 100).toFixed(1) : 'N/A';
                    const direction = diff > 0 ? 'SLOWER' : 'FASTER';
                    console.log(
                        `  ${direction}: ${testName} [${fwName}]: ${prev.mean.toFixed(4)} -> ${cur.mean.toFixed(4)} ms (${pct}%)`
                    );
                }
            }
        }
        if (!hasSignificantChanges) {
            console.log('  No statistically significant changes detected.');
        }
        console.log('');
        console.log(`[bench] results-browser.csv exists; not overwriting (${sc} scenarios x ${lc} libs in this run)`);
    } else {
        await writeFile(csvPath, benchResultsPayload.csv);
        console.log(`[bench] wrote results-browser.csv (${sc} scenarios x ${lc} libs)`);
    }
} else {
    console.error('[bench-browser] no [bench-results] payload received; results-browser.csv NOT written');
    process.exit(1);
}
