import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.spec.mjs'],
        exclude: ['**/node_modules/**'],
        browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
        },
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            exclude: ['node_modules', '**/tests/**', '**/dist/**', '**/types/**', '**/*.config.js', '**/*.d.ts'],
        },
        typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
        },
    },
});
