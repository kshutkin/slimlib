//@ts-nocheck

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { rollup } from 'rollup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, '..', '.bundle-size');

const peers = ['@slimlib/jsx', '@slimlib/store'];

const entries = [
    {
        name: '@slimlib/element (peers external)',
        code: `export * from '@slimlib/element';`,
        external: peers,
    },
    {
        name: '@slimlib/element (with peers)',
        code: `export * from '@slimlib/element';`,
        external: [],
    },
];

async function bundleOnce(entryPath, minify, external) {
    const isExternal = id => external.includes(id) || external.some(p => id.startsWith(`${p}/`));
    const plugins = [nodeResolve({ exportConditions: ['production'] })];
    if (minify) {
        plugins.push(terser({ compress: { passes: 2 }, format: { comments: false } }));
    }
    const bundle = await rollup({ input: entryPath, external: isExternal, plugins, onwarn() {} });
    const { output } = await bundle.generate({ format: 'es' });
    await bundle.close();
    return Buffer.from(output[0].code);
}

function fmt(n) {
    if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${n} B`;
}

async function measure(entry) {
    const file = join(tmpDir, `${entry.name.replace(/[^a-z0-9.+-]/gi, '_')}.mjs`);
    await writeFile(file, entry.code);
    try {
        const [raw, min] = await Promise.all([bundleOnce(file, false, entry.external), bundleOnce(file, true, entry.external)]);
        const gz = gzipSync(min);
        const br = brotliCompressSync(min, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        });
        return {
            name: entry.name,
            raw: raw.length,
            min: min.length,
            gzip: gz.length,
            brotli: br.length,
        };
    } catch (err) {
        return { name: entry.name, error: err.message };
    }
}

async function main() {
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const results = [];
    for (const entry of entries) {
        results.push(await measure(entry));
    }

    const widths = {
        name: Math.max(4, ...results.map(r => r.name.length)),
        raw: 10,
        min: 10,
        gzip: 10,
        brotli: 10,
    };

    const header = `${'name'.padEnd(widths.name)}  ${'raw'.padStart(widths.raw)}  ${'min'.padStart(widths.min)}  ${'gzip'.padStart(widths.gzip)}  ${'brotli'.padStart(widths.brotli)}`;
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of results) {
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

    for (const r of results.filter(r => r.error)) {
        console.warn(`\n[warn] ${r.name}: ${r.error}`);
    }

    await rm(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
