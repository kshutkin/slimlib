// Lightweight esbuild dev server for the @slimlib/element playground.
// Bundles main.jsx in-memory and serves the playground directory.
// Run with: pnpm play

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const elementRoot = resolve(here, '..');
const repoRoot = resolve(elementRoot, '..');
const jsxRoot = resolve(repoRoot, 'jsx');
const storeRoot = resolve(repoRoot, 'store');

const aliasPlugin = {
    name: 'slimlib-alias',
    setup(build) {
        const aliases = [
            { filter: /^@slimlib\/element$/, target: resolve(elementRoot, 'src/index.js') },
            { filter: /^@slimlib\/jsx\/jsx-runtime$/, target: resolve(jsxRoot, 'src/jsx-runtime.ts') },
            { filter: /^@slimlib\/jsx\/jsx-dev-runtime$/, target: resolve(jsxRoot, 'src/jsx-runtime.ts') },
            { filter: /^@slimlib\/jsx\/for-each$/, target: resolve(jsxRoot, 'src/for-each.ts') },
            { filter: /^@slimlib\/jsx$/, target: resolve(jsxRoot, 'src/index.ts') },
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

const port = Number(process.env.PORT ?? 5181);
const result = await ctx.serve({ servedir: here, port, host: '127.0.0.1' });

const host = result.hosts?.[0] ?? result.host ?? '127.0.0.1';
const actualPort = result.port;
const url = `http://${host}:${actualPort}/`;
console.log(`@slimlib/element playground → ${url}`);
console.log('  (Ctrl-C to stop)');
