import { describe, expect, it } from 'vitest';

import { defineElement } from '../src/index.js';

describe('element', () => {
    it('smoke', () => {
        // signature: (tag, render) | (tag, defaults, render)
        expect(typeof defineElement).toBe('function');
        expect(defineElement.length).toBeGreaterThanOrEqual(2);
    });
    // TODO: full DOM smoke once a DOM environment is added to vitest
});
