import rollupPluginNodeResolve from '@rollup/plugin-node-resolve';
import rollupExtrasPluginClean from '@rollup-extras/plugin-clean';
import rollupExtrasPluginExternals from '@rollup-extras/plugin-externals';
import rollupExtrasPluginMangle from '@rollup-extras/plugin-mangle';
import rollupPluginTypescript2 from 'rollup-plugin-typescript2';

export default [
    {
        input: ['./src/index.ts', './src/jsx-runtime.ts'],
        output: [
            {
                format: 'es',
                dir: 'dist',
                entryFileNames: '[name].mjs',
                plugins: [rollupExtrasPluginClean(), rollupExtrasPluginMangle()],
                sourcemap: true,
                chunkFileNames: '[name].mjs',
            },
        ],
        plugins: [
            rollupExtrasPluginExternals({}),
            rollupPluginNodeResolve(),
            rollupPluginTypescript2({
                tsconfigOverride: {
                    compilerOptions: {
                        composite: false,
                        declaration: false,
                        declarationMap: false,
                    },
                },
            }),
        ],
    },
];
