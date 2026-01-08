//@ts-nocheck

/**
 * Compressed Size Report
 * Measures the minified (terser) size of the store module
 *
 * Run with: node tests/size-report.mjs
 *
 * Options:
 *   -f, --file <path>     JSON file to save/compare results
 *   -u, --update          Update the baseline file (overwrite existing)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { minify } from 'terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_FILE = join(__dirname, '../src/index.js');

/**
 * Get the compressed size using terser
 */
async function getCompressedSize(filePath) {
    let source = readFileSync(filePath, 'utf-8');

    source = source.replace("import { DEV } from 'esm-env';", 'const DEV = 0;');

    const result = await minify(source, {
        compress: {
            passes: 2,
            pure_getters: true,
            unsafe: true,
        },
        mangle: {
            properties: false,
        },
        format: {
            comments: false,
        },
    });

    if (!result.code) {
        throw new Error('Terser failed to minify the code');
    }

    return {
        originalSize: Buffer.byteLength(source, 'utf-8'),
        compressedSize: Buffer.byteLength(result.code, 'utf-8'),
    };
}

/**
 * Load previous results from JSON file
 */
function loadPreviousResults(filePath) {
    if (!existsSync(filePath)) {
        return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}

/**
 * Save results to JSON file
 */
function saveResults(filePath, results) {
    writeFileSync(filePath, `${JSON.stringify(results, null, 2)}\n`);
}

/**
 * Compare current and previous sizes
 */
function compareSizes(current, previous) {
    const diff = current - previous;
    const pctChange = previous !== 0 ? ((diff / previous) * 100).toFixed(1) : 'N/A';

    let status;
    if (diff > 0) {
        status = 'LARGER';
    } else if (diff < 0) {
        status = 'SMALLER';
    } else {
        status = 'UNCHANGED';
    }

    return { diff, pctChange, status };
}

async function main() {
    // Parse command line arguments
    const { values: args } = parseArgs({
        options: {
            file: {
                type: 'string',
                short: 'f',
            },
            update: {
                type: 'boolean',
                short: 'u',
                default: false,
            },
        },
        strict: false,
        allowPositionals: true,
    });

    const outputFile = args.file;
    const shouldUpdate = args.update;

    console.log('='.repeat(60));
    console.log('Compressed Size Report (@slimlib/store)');
    console.log('='.repeat(60));
    console.log('');

    // Get current compressed size
    console.log('Measuring compressed size...');
    const { originalSize, compressedSize } = await getCompressedSize(SOURCE_FILE);

    console.log('');
    console.log(`Source file: src/index.js`);
    console.log(`Original size: ${originalSize} bytes`);
    console.log(`Compressed size (terser): ${compressedSize} bytes`);
    console.log(`Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`);
    console.log('');

    const currentResults = {
        originalSize,
        compressedSize,
        timestamp: new Date().toISOString(),
    };

    // Check if we're comparing with existing file
    if (outputFile) {
        const previousResults = loadPreviousResults(outputFile);

        if (previousResults && !shouldUpdate) {
            console.log('='.repeat(60));
            console.log('Comparison with Previous Results');
            console.log('='.repeat(60));
            console.log('');

            const comparison = compareSizes(compressedSize, previousResults.compressedSize);

            if (comparison.status === 'UNCHANGED') {
                console.log('  No change in compressed size.');
            } else {
                const sign = comparison.diff > 0 ? '+' : '';
                console.log(
                    `  ${comparison.status}: ${previousResults.compressedSize} -> ${compressedSize} bytes ` +
                        `(${sign}${comparison.diff} bytes, ${sign}${comparison.pctChange}%)`
                );
            }

            console.log('');
            console.log(`Previous measurement: ${previousResults.timestamp}`);
        } else {
            // Save results if file doesn't exist or --update flag is set
            saveResults(outputFile, currentResults);
            if (shouldUpdate && previousResults) {
                console.log(`Baseline updated: ${outputFile}`);
            } else {
                console.log(`Results saved to: ${outputFile}`);
            }
        }
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
