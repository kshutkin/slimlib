import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('package.json').toString());
const scopeTest = /(@.+)\/.+$/g.exec(pkg.name);
let scope = undefined;
let moduleNameMapper = {};
if (scopeTest && scopeTest[0]) {
    scope = scopeTest[1];
    moduleNameMapper[`${scope}/(.*)/(.*)`] = '<rootDir>/../$1/src/$2.ts';
    moduleNameMapper[`${scope}/(.*)$`] = '<rootDir>/../$1/src';
    moduleNameMapper['^preact(/(.*)|$)'] = 'preact$1';
}

/** @type {import('ts-jest/dist/types').JestConfigWithTsJest} */
export default {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    extensionsToTreatAsEsm: ['.ts', '.tsx', '.svelte'],
    testMatch: ['<rootDir>/**/tests/**/*.spec.ts*'],
    transform: {
        '^.+\\.svelte$': 'svelte-jester',
        '^.+\\.ts$': ['ts-jest', { useESM: true }],
        '^.+\\.tsx$': ['ts-jest', { useESM: true }]
    },
    testPathIgnorePatterns: ['/node_modules/'],
    coverageDirectory: './coverage',
    coveragePathIgnorePatterns: ['node_modules', 'src/tests'],
    moduleNameMapper
};