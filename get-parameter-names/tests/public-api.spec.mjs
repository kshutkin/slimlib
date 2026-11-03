import { describe, expect, it } from 'vitest';

import { getParameterNames } from '@slimlib/get-parameter-names';

describe('getParameterNames through the public API', () => {
    it('returns no parameter names for a class with an implicit constructor', () => {
        class Example {}

        expect(getParameterNames(Example)).toEqual([]);
        expect(getParameterNames(Example.toString())).toEqual([]);
    });
});
