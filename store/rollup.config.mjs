import rollupPluginCommonjs from '@rollup/plugin-commonjs';
import rollupPluginJson from '@rollup/plugin-json';
import rollupPluginNodeResolve from '@rollup/plugin-node-resolve';
import rollupExtrasPluginClean from '@rollup-extras/plugin-clean';
import rollupExtrasPluginExternals from '@rollup-extras/plugin-externals';
import rollupPluginTypescript2 from 'rollup-plugin-typescript2';
import MagicString from 'magic-string';
import { walk } from 'estree-walker';
new Map([['index', 'ts']]);

// Custom plugin to mangle $_ prefixed properties using AST
function manglePropertiesPlugin() {
    const propertyMap = new Map();
    let counter = 0;

    const getMangled = (name) => {
        if (!propertyMap.has(name)) {
            // Generate short mangled names: a, b, c, ... z, aa, ab, ...
            let n = counter++;
            let result = '';
            do {
                result = String.fromCharCode(97 + (n % 26)) + result;
                n = Math.floor(n / 26) - 1;
            } while (n >= 0);
            propertyMap.set(name, result);
        }
        return propertyMap.get(name);
    };

    const shouldMangle = (name) => name?.startsWith('$_');

    return {
        name: 'mangle-properties',
        renderChunk(code, chunk) {
            const ast = this.parse(code);
            // Use the chunk's file name as the source for proper mapping
            const magicString = new MagicString(code, {
                filename: chunk.fileName
            });

            // Track positions we've already handled to avoid duplicate overwrites
            const handledPositions = new Set();

            walk(ast, {
                enter(node, parent) {
                    // Property in object literal or destructuring pattern: { $_prop: value } or { $_prop }
                    if (node.type === 'Property' && node.key.type === 'Identifier' && shouldMangle(node.key.name)) {
                        const mangledName = getMangled(node.key.name);

                        if (node.shorthand) {
                            // For shorthand { $_prop }, key and value share the same position
                            // We need to expand to { mangledName: mangledName }
                            if (!handledPositions.has(node.key.start)) {
                                magicString.overwrite(node.key.start, node.key.end, mangledName + ': ' + mangledName);
                                handledPositions.add(node.key.start);
                            }
                        } else {
                            // Non-shorthand property: just mangle the key
                            if (!handledPositions.has(node.key.start)) {
                                magicString.overwrite(node.key.start, node.key.end, mangledName);
                                handledPositions.add(node.key.start);
                            }
                        }
                    }
                    // Member expression: obj.$_prop
                    else if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && shouldMangle(node.property.name)) {
                        if (!handledPositions.has(node.property.start)) {
                            magicString.overwrite(node.property.start, node.property.end, getMangled(node.property.name));
                            handledPositions.add(node.property.start);
                        }
                    }
                    // Identifier used as variable that matches a mangled property name
                    // This catches the local variable usage from shorthand destructuring
                    else if (node.type === 'Identifier' && shouldMangle(node.name)) {
                        // Only mangle if it's a variable reference (not a property key or member access which are handled above)
                        const isPropertyKey = parent?.type === 'Property' && parent.key === node;
                        const isPropertyValue = parent?.type === 'Property' && parent.value === node;
                        const isMemberProp = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;

                        // Skip if this is part of a property (key or shorthand value) or member expression
                        if (!isPropertyKey && !isPropertyValue && !isMemberProp) {
                            if (!handledPositions.has(node.start)) {
                                magicString.overwrite(node.start, node.end, getMangled(node.name));
                                handledPositions.add(node.start);
                            }
                        }
                    }
                }
            });

            return {
                code: magicString.toString(),
                // Generate a proper source map for the mangled property names
                // hires: true provides character-level mappings for accurate column positions
                // Don't set source - Rollup will handle source map composition
                map: magicString.generateMap({ hires: true })
            };
        }
    };
}

export default [
    {
        input: ['./src/index.ts'],
        output: [
            {
                format: 'es',
                dir: 'dist',
                entryFileNames: '[name].mjs',
                plugins: [
                    rollupExtrasPluginClean(),
                    manglePropertiesPlugin(),
                ],
                sourcemap: true,
                chunkFileNames: '[name].mjs',
            },
        ],
        plugins: [
            rollupPluginJson(),
            rollupExtrasPluginExternals({}),
            rollupPluginNodeResolve(),
            rollupPluginCommonjs(),
            rollupPluginTypescript2(),
        ],
    },
];
