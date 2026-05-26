import { describe, expect, it } from 'vitest';

import { defineElement, extend } from '../src/index.js';

describe('element', () => {
    it('smoke', () => {
        // signature: (tag, render) | (tag, attrs, render)
        expect(typeof defineElement).toBe('function');
        expect(typeof extend).toBe('function');
    });
    // TODO: full DOM smoke once a DOM environment is added to vitest
});
