import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test-d.ts'],
        typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
        },
    },
});
