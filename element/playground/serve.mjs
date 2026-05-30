// Lightweight esbuild dev server for the @slimlib/element playground.
// Bundles main.jsx in-memory and serves the playground directory.
// Run with: pnpm play

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

const playgroundDirectory = dirname(fileURLToPath(import.meta.url));
const elementRoot = resolve(playgroundDirectory, '..');
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

const buildContext = await context({
    entryPoints: { main: resolve(playgroundDirectory, 'main.jsx') },
    bundle: true,
    format: 'esm',
    outdir: playgroundDirectory,
    write: false,
    jsx: 'automatic',
    jsxImportSource: '@slimlib/jsx',
    sourcemap: 'inline',
    plugins: [aliasPlugin],
    loader: { '.ts': 'ts' },
});

const port = Number(process.env.PORT ?? 5181);
const serverResult = await buildContext.serve({ servedir: playgroundDirectory, port, host: '127.0.0.1' });

const host = serverResult.hosts?.[0] ?? serverResult.host ?? '127.0.0.1';
const actualPort = serverResult.port;
const serverUrl = `http://${host}:${actualPort}/`;
console.log(`@slimlib/element playground → ${serverUrl}`);
console.log('  (Ctrl-C to stop)');
