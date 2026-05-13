import { describe, expect, it } from 'vitest';

import { createElement, Fragment, render } from '../src/index.js';
import { jsx, jsxDEV, jsxs, Fragment as RuntimeFragment } from '../src/jsx-runtime.js';

describe('@slimlib/jsx', () => {
    it('exports the public API', () => {
        expect(createElement).toBeTypeOf('function');
        expect(render).toBeTypeOf('function');
        expect(Fragment).toBeTypeOf('symbol');
    });

    it('exposes a jsx-runtime', () => {
        expect(jsx).toBeTypeOf('function');
        expect(jsxs).toBeTypeOf('function');
        expect(jsxDEV).toBeTypeOf('function');
        expect(RuntimeFragment).toBe(Fragment);
    });
});
