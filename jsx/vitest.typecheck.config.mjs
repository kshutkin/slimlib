import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test-d.tsx'],
        typecheck: { enabled: true, include: ['tests/**/*.test-d.tsx'], tsconfig: './tsconfig.test-types.json' },
    },
});
