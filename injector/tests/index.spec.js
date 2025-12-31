import { describe, it, expect } from 'vitest';
import createInject from '../src/index.js';

describe('createInject', () => {

    it('smoke', () => {
        expect(createInject).toBeDefined();
    });

    it('provide / inject', () => {
        const inject = createInject();

        inject(function($provide) {
            $provide('value', 'test');
        });

        const value = inject(function(value) {
            return value;
        });

        expect(value).toEqual('test');
    });
});