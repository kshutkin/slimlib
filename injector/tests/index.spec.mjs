import { describe, expect, it } from 'vitest';

import { createInject } from '../src/index.js';

describe('createInject', () => {
    it('smoke', () => {
        expect(createInject).toBeDefined();
    });

    it('provide / inject', () => {
        const inject = createInject();

        // biome-ignore lint/complexity/useArrowFunction: getParameterNames requires regular functions
        inject(function ($provide) {
            $provide('value', 'test');
        });

        // biome-ignore lint/complexity/useArrowFunction: getParameterNames requires regular functions
        const value = inject(function (value) {
            return value;
        });

        expect(value).toEqual('test');
    });
});
