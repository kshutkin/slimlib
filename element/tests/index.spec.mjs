import { describe, expect, it } from 'vitest';

import { defineElement } from '../src/index.js';

describe('element', () => {
    it('smoke', () => {
        expect(typeof defineElement).toBe('function');
    });
    // TODO: DOM tests once vitest is configured with happy-dom/jsdom
});
