import rollupPluginCommonjs from '@rollup/plugin-commonjs';
import rollupPluginJson from '@rollup/plugin-json';
import rollupPluginNodeResolve from '@rollup/plugin-node-resolve';
import rollupPluginTerser from '@rollup/plugin-terser';
import rollupExtrasPluginClean from '@rollup-extras/plugin-clean';
import rollupExtrasPluginExternals from '@rollup-extras/plugin-externals';
import rollupExtrasPluginMangle from '@rollup-extras/plugin-mangle';
import rollupPluginTypescript2 from 'rollup-plugin-typescript2';

// Check if we're in compress mode (set via environment variable)
const isCompress = process.env.BUILD_COMPRESS === 'true';

// Build output plugins based on mode
function getOutputPlugins() {
    const plugins = [rollupExtrasPluginClean(), rollupExtrasPluginMangle()];

    if (isCompress) {
        plugins.push(
            rollupPluginTerser({
                compress: {
                    passes: 3,
                    pure_getters: true,
                    unsafe: true,
                    comparisons: false,
                },
                mangle: {
                    properties: false, // We already handle property mangling
                },
                format: {
                    comments: false,
                },
            })
        );
    }

    return plugins;
}

// Build input plugins based on mode
function getInputPlugins() {
    const plugins = [rollupPluginJson()];

    // In compress mode, don't externalize dependencies (bundle everything)
    if (!isCompress) {
        plugins.push(rollupExtrasPluginExternals({}));
    }

    plugins.push(
        rollupPluginNodeResolve(),
        rollupPluginCommonjs(),
        rollupPluginTypescript2({
            tsconfigOverride: {
                compilerOptions: {
                    composite: false,
                    declaration: false,
                    declarationMap: false,
                },
            },
        })
    );

    return plugins;
}

export default [
    {
        input: ['./src/index.ts'],
        output: [
            {
                format: 'es',
                dir: 'dist',
                entryFileNames: '[name].mjs',
                plugins: getOutputPlugins(),
                sourcemap: !isCompress,
                chunkFileNames: '[name].mjs',
            },
        ],
        plugins: getInputPlugins(),
    },
];
