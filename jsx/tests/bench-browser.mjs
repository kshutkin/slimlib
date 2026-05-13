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

import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    // happy-dom is referenced behind `if (typeof window === 'undefined')` via
    // a dynamic import — esbuild will produce a chunk it never loads in the
    // browser. Mark it external as a belt-and-suspenders so the bundle stays
    // small and we never fault on a node-only dep at import time.
    external: ['happy-dom', 'bun:jsc', 'node:os', 'node:v8', 'node:process']
});

await writeFile(
    htmlPath,
    `<!doctype html>
<meta charset="utf-8"><title>bench</title>
<body>
<script type="importmap">
{ "imports": {
  "happy-dom": "data:text/javascript,export const Window = class {};",
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
    '.map': 'application/json'
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

await new Promise((r) => server.listen(0, r));
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
    browser = await chromium.launch({ headless: true });
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
page.on('console', (msg) => {
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
page.on('pageerror', (err) => {
    process.stderr.write('PAGE ERROR: ' + (err.stack || err.message) + '\n');
});

await page.goto(`http://127.0.0.1:${port}/`);

const deadline = Date.now() + 5 * 60_000;
while (!done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
}

await browser.close();
server.close();

if (!done) {
    console.error('[bench-browser] bench did not complete within 5 minutes');
    process.exit(1);
}

if (benchResultsPayload?.csv) {
    const csvPath = fileURLToPath(new URL('../results-browser.csv', import.meta.url));
    await writeFile(csvPath, benchResultsPayload.csv);
    const sc = benchResultsPayload.scenarioCount ?? '?';
    const lc = benchResultsPayload.libOrder?.length ?? '?';
    console.log(`[bench] wrote results-browser.csv (${sc} scenarios x ${lc} libs)`);
} else {
    console.error('[bench-browser] no [bench-results] payload received; results-browser.csv NOT written');
    process.exit(1);
}
