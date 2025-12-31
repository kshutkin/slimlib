import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json').toString());
const scopeTest = /(@.+)\/.+$/g.exec(pkg.name);
let scope = undefined;
let moduleNameMapper = {};
if (scopeTest && scopeTest[0]) {
    scope = scopeTest[1];
    moduleNameMapper[`${scope}/(.*)/(.*)`] = '<rootDir>/../$1/src/$2.js';
    moduleNameMapper[`${scope}/(.*)$`] = '<rootDir>/../$1/src/index.js';
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: 'ts-jest/presets/js-with-ts-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    testMatch: ['<rootDir>/**/tests/**/*.spec.ts'],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
    testPathIgnorePatterns: ['/node_modules/'],
    coverageDirectory: './coverage',
    coveragePathIgnorePatterns: ['node_modules', 'tests'],
    moduleNameMapper
};