import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');

// Vite uses esbuild for JSX transform. Tell esbuild to emit the automatic
// runtime targeting @slimlib/jsx. Alias the package names to the local source
// so edits to ../src/* hot-reload here.
export default defineConfig({
    root: here,
    resolve: {
        alias: {
            '@slimlib/jsx/jsx-runtime': resolve(repoRoot, 'src/jsx-runtime.ts'),
            '@slimlib/jsx/jsx-dev-runtime': resolve(repoRoot, 'src/jsx-runtime.ts'),
            '@slimlib/jsx/for-each': resolve(repoRoot, 'src/for-each.ts'),
            '@slimlib/jsx': resolve(repoRoot, 'src/index.ts'),
            '@slimlib/store': resolve(repoRoot, '../store/src/index.ts'),
        },
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: '@slimlib/jsx',
    },
    server: {
        port: 5180,
        open: true,
    },
});
