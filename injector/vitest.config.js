import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.spec.{ts,js}'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.js'],
            reporter: ['text', 'lcov'],
        },
    },
    esbuild: {
        keepNames: true,
        minifyIdentifiers: false,
    },
});