// Lightweight esbuild dev server for the playground.
// Bundles main.jsx in-memory and serves the playground directory.
// Run with: pnpm play

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const storeRoot = resolve(repoRoot, '../store');

const aliasPlugin = {
    name: 'slimlib-alias',
    setup(build) {
        const aliases = [
            { filter: /^@slimlib\/jsx\/jsx-runtime$/, target: resolve(repoRoot, 'src/jsx-runtime.ts') },
            { filter: /^@slimlib\/jsx\/jsx-dev-runtime$/, target: resolve(repoRoot, 'src/jsx-runtime.ts') },
            { filter: /^@slimlib\/jsx\/for-each$/, target: resolve(repoRoot, 'src/for-each.ts') },
            { filter: /^@slimlib\/jsx$/, target: resolve(repoRoot, 'src/index.ts') },
            { filter: /^@slimlib\/store$/, target: resolve(storeRoot, 'src/index.ts') },
        ];
        for (const { filter, target } of aliases) {
            build.onResolve({ filter }, () => ({ path: target }));
        }
    },
};

const ctx = await context({
    entryPoints: { main: resolve(here, 'main.jsx') },
    bundle: true,
    format: 'esm',
    outdir: here,
    write: false,
    jsx: 'automatic',
    jsxImportSource: '@slimlib/jsx',
    sourcemap: 'inline',
    plugins: [aliasPlugin],
    loader: { '.ts': 'ts' },
});

const port = Number(process.env.PORT ?? 5180);
const result = await ctx.serve({ servedir: here, port, host: '127.0.0.1' });

const host = result.hosts?.[0] ?? result.host ?? '127.0.0.1';
const actualPort = result.port;
const url = `http://${host}:${actualPort}/`;
console.log(`@slimlib/jsx playground → ${url}`);
console.log('  (Ctrl-C to stop)');
