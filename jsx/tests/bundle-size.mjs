//@ts-nocheck
import { build } from 'esbuild';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, '..', '.bundle-size', 'entries');

const entries = [
    { name: 'uhtml', code: `import { html, render } from 'uhtml'; export { html, render };` },
    { name: 'lighterhtml', code: `import { html, render } from 'lighterhtml'; export { html, render };` },
    { name: 'lit-html', code: `import { html, render } from 'lit-html'; export { html, render };` },
    { name: 'lit-html+repeat', code: `import { html, render } from 'lit-html'; import { repeat } from 'lit-html/directives/repeat.js'; export { html, render, repeat };` },
    { name: 'nano-jsx', code: `import Nano, { h } from 'nano-jsx'; export { Nano, h };` },
    { name: 'voby', code: `import { $, render, h, For } from 'voby'; export { $, render, h, For };` },
    { name: 'vanjs-core', code: `import van from 'vanjs-core'; export { van };` },
    { name: 'solid-js', code: `import { createSignal, createRoot, For } from 'solid-js'; import { render } from 'solid-js/web'; import h from 'solid-js/h'; export { createSignal, createRoot, For, render, h };` },
    { name: 'preact', code: `import { h, render } from 'preact'; export { h, render };` },
    { name: 'mithril', code: `import m from 'mithril'; export { m };` },
    { name: 'snabbdom', code: `import { init, h, classModule, propsModule, attributesModule, eventListenersModule } from 'snabbdom'; export { init, h, classModule, propsModule, attributesModule, eventListenersModule };` },
    { name: '@mastrojs/reactive', code: `import { ReactiveElement, signal } from '@mastrojs/reactive'; export { ReactiveElement, signal };` }
];

async function bundleOnce(entryPath, minify) {
    const result = await build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        minify,
        write: false,
        treeShaking: true,
        logLevel: 'silent'
    });
    return Buffer.from(result.outputFiles[0].contents);
}

function fmt(n) {
    if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${n} B`;
}

async function measure(entry) {
    const file = join(tmpDir, `${entry.name.replace(/[^a-z0-9.+-]/gi, '_')}.mjs`);
    await writeFile(file, entry.code);
    try {
        const [raw, min] = await Promise.all([
            bundleOnce(file, false),
            bundleOnce(file, true)
        ]);
        const gz = gzipSync(min);
        const br = brotliCompressSync(min, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
        });
        return {
            name: entry.name,
            raw: raw.length,
            min: min.length,
            gzip: gz.length,
            brotli: br.length
        };
    } catch (err) {
        return { name: entry.name, error: err.message };
    }
}

async function main() {
    await rm(join(__dirname, '..', '.bundle-size'), { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const results = await Promise.all(entries.map(measure));

    const ok = results.filter(r => !r.error).sort((a, b) => a.gzip - b.gzip);
    const failed = results.filter(r => r.error);
    const ordered = [...ok, ...failed];

    const cols = ['name', 'raw', 'min', 'gzip', 'brotli'];
    const widths = {
        name: Math.max(4, ...ordered.map(r => r.name.length)),
        raw: 10,
        min: 10,
        gzip: 10,
        brotli: 10
    };

    const header = `${'name'.padEnd(widths.name)}  ${'raw'.padStart(widths.raw)}  ${'min'.padStart(widths.min)}  ${'gzip'.padStart(widths.gzip)}  ${'brotli'.padStart(widths.brotli)}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of ordered) {
        if (r.error) {
            console.log(
                `${r.name.padEnd(widths.name)}  ${'[error]'.padStart(widths.raw)}  ${'[error]'.padStart(widths.min)}  ${'[error]'.padStart(widths.gzip)}  ${'[error]'.padStart(widths.brotli)}`
            );
        } else {
            console.log(
                `${r.name.padEnd(widths.name)}  ${fmt(r.raw).padStart(widths.raw)}  ${fmt(r.min).padStart(widths.min)}  ${fmt(r.gzip).padStart(widths.gzip)}  ${fmt(r.brotli).padStart(widths.brotli)}`
            );
        }
    }

    for (const r of failed) {
        console.warn(`\n[warn] ${r.name}: ${r.error}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
