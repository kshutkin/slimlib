import { describe, expect, it } from 'vitest';

import createRecordingMockFactory from '../src/index.js';

/** @param {unknown} code */
const evaluate = code => new Function(`return (${code});`)();

describe('generated literals and property keys', () => {
    it('round-trips quotes, backslashes, line breaks, and control characters', () => {
        const { generate } = createRecordingMockFactory();
        const value = 'a"b\\c\nd\r\t\0\u2028\u2029';
        expect(evaluate(generate(value))).toBe(value);
    });

    it('round-trips object keys that require quoting', () => {
        const { generate } = createRecordingMockFactory();
        const value = { 'x-y': 1, 'a"b\\c\nd': 2, '': 3, 123: 4, ['__proto__']: { own: true } };
        const result = evaluate(generate(value));
        expect(result).toEqual(value);
        expect(Object.hasOwn(result, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it('replays inline and shared property reads with escaped keys', () => {
        const { createMock, generate, generateGlobals } = createRecordingMockFactory();
        const key = 'a"b\\c\nd';
        const child = { value: 0 };
        const mock = createMock({ [key]: child }, 'root');
        const shared = mock[key];
        shared.value = 1;
        const code = generate([shared, shared]);
        const replay = new Function('root', `${generateGlobals()}\nreturn (${code});`);
        const root = { [key]: { value: 0 } };
        const result = replay(root);
        expect(result[0]).toBe(root[key]);
        expect(result[1]).toBe(root[key]);
        expect(root[key].value).toBe(1);

        const inline = createRecordingMockFactory();
        const inlineCode = inline.generate(inline.createMock({ [key]: child }, 'root')[key]);
        expect(new Function('root', `return (${inlineCode});`)({ [key]: child })).toBe(child);
    });

    it('replays property assignments and deletions with escaped keys', () => {
        const { createMock, generateGlobals } = createRecordingMockFactory();
        const key = 'a"b\\c\nd';
        const removed = 'remove"\\\n';
        const mock = createMock({ [key]: '', [removed]: true }, 'root');
        mock[key] = 'value"\\\n';
        Reflect.deleteProperty(mock, removed);
        const root = { [key]: '', [removed]: true };
        new Function('root', generateGlobals())(root);
        expect(root).toEqual({ [key]: 'value"\\\n' });
    });
});
