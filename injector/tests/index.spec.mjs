import { describe, expect, it } from 'vitest';

import { createInject, createInjectAnnotated } from '../src/index.js';

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

describe('createInjectAnnotated', () => {
    it('smoke', () => {
        expect(createInjectAnnotated).toBeDefined();
    });

    it('provide / inject with array annotation', () => {
        const inject = createInjectAnnotated();

        inject([
            '$provide',
            $provide => {
                $provide('value', 'test');
            },
        ]);

        const value = inject([
            'value',
            value => {
                return value;
            },
        ]);

        expect(value).toEqual('test');
    });

    it('inject multiple dependencies', () => {
        const inject = createInjectAnnotated();

        inject([
            '$provide',
            $provide => {
                $provide('a', 1);
                $provide('b', 2);
                $provide('c', 3);
            },
        ]);

        const result = inject([
            'a',
            'b',
            'c',
            (a, b, c) => {
                return a + b + c;
            },
        ]);

        expect(result).toEqual(6);
    });

    it('works with minified parameter names', () => {
        const inject = createInjectAnnotated();

        inject([
            '$provide',
            p => {
                p('config', { url: 'http://example.com' });
                p('logger', { log: msg => msg });
            },
        ]);

        // Simulating minified code where parameter names don't match dependency names
        const result = inject([
            'config',
            'logger',
            (x, y) => {
                return { configUrl: x.url, hasLogger: typeof y.log === 'function' };
            },
        ]);

        expect(result).toEqual({ configUrl: 'http://example.com', hasLogger: true });
    });

    it('function without array gets no dependencies', () => {
        const inject = createInjectAnnotated();

        inject([
            '$provide',
            $provide => {
                $provide('value', 'test');
            },
        ]);

        const result = inject(() => {
            return 'no deps';
        });

        expect(result).toEqual('no deps');
    });

    it('respects scope parameter', () => {
        const inject = createInjectAnnotated();

        inject([
            '$provide',
            $provide => {
                $provide('multiplier', 2);
            },
        ]);

        const obj = { base: 10 };

        const result = inject(
            [
                'multiplier',
                function (multiplier) {
                    return this.base * multiplier;
                },
            ],
            obj
        );

        expect(result).toEqual(20);
    });

    it('handles empty dependency array', () => {
        const inject = createInjectAnnotated();

        const result = inject([
            () => {
                return 'empty deps';
            },
        ]);

        expect(result).toEqual('empty deps');
    });
});
