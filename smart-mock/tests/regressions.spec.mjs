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

describe('undefined serialization', () => {
    it('preserves explicit undefined array elements and object properties', () => {
        const { generate } = createRecordingMockFactory();
        const value = { array: [undefined, 1, undefined], single: [undefined], property: undefined };
        const result = evaluate(generate(value));
        expect(result).toEqual(value);
        expect(result.array).toHaveLength(3);
        expect(result.single).toHaveLength(1);
        expect(Object.hasOwn(result, 'property')).toBe(true);
        expect(generate(undefined)).toBeUndefined();
    });

    it('preserves undefined arguments in inline and shared calls', () => {
        const { createMock, generate, generateGlobals } = createRecordingMockFactory();
        /** @param {...unknown} args */
        const root = (...args) => ({ args, tag: false });
        const mock = createMock(root, 'root');
        const inline = generate(mock(undefined));
        expect(new Function('root', `return (${inline});`)(root).args).toEqual([undefined]);

        const shared = mock(undefined, 1, undefined);
        shared.tag = true;
        const code = generate(shared);
        const result = new Function('root', `${generateGlobals()}\nreturn (${code});`)(root);
        expect(result.args).toEqual([undefined, 1, undefined]);
    });

    it('preserves undefined arguments in side-effect calls and constructors', () => {
        const { createMock, generate, generateGlobals } = createRecordingMockFactory();
        /** @type {unknown[][]} */
        const calls = [];
        const mock = createMock((/** @type {unknown[]} */ ...args) => {
            calls.push(args);
        }, 'record');
        mock(undefined, 1, undefined);
        const globals = generateGlobals();
        calls.length = 0;
        new Function('record', globals)((/** @type {unknown[]} */ ...args) => {
            calls.push(args);
        });
        expect(calls).toEqual([[undefined, 1, undefined]]);

        class Root {
            /** @param {...unknown} args */
            constructor(...args) {
                this.args = args;
            }
        }
        const Constructor = createMock(Root, 'Root');
        const code = generate(new Constructor(undefined, 1, undefined));
        expect(new Function('Root', `return (${code});`)(Root).args).toEqual([undefined, 1, undefined]);
    });
});

describe('property mock caching', () => {
    it('refreshes replaced objects and functions while preserving stable reads', () => {
        const { createMock } = createRecordingMockFactory();
        const root = { child: { value: 1 }, method: () => 1 };
        const mock = createMock(root, 'root');
        const previous = mock.child;
        const previousMethod = mock.method;
        expect(mock.child).toBe(previous);
        expect(mock.method).toBe(previousMethod);
        mock.child = { value: 2 };
        mock.method = () => 2;
        expect(mock.child).not.toBe(previous);
        expect(mock.child.value).toBe(2);
        expect(mock.method).not.toBe(previousMethod);
        expect(mock.method()).toBe(2);
        expect(mock.child).toBe(mock.child);
        expect(mock.method).toBe(mock.method);
    });

    it('refreshes deleted, restored, and redefined properties', () => {
        const { createMock } = createRecordingMockFactory();
        const mock = createMock({ child: { value: 1 } }, 'root');
        const previous = mock.child;
        Reflect.deleteProperty(mock, 'child');
        expect(mock.child).toBeUndefined();
        mock.child = { value: 2 };
        expect(mock.child.value).toBe(2);
        expect(mock.child).not.toBe(previous);
        Object.defineProperty(mock, 'child', { value: { value: 3 } });
        expect(mock.child.value).toBe(3);
    });

    it('refreshes values changed through the raw object or a getter', () => {
        const { createMock } = createRecordingMockFactory();
        const root = { child: { value: 1 } };
        const mock = createMock(root, 'root');
        void mock.child;
        root.child = { value: 2 };
        expect(mock.child.value).toBe(2);

        let value = 0;
        const getter = createMock(
            {
                get child() {
                    return { value: ++value };
                },
            },
            'getter'
        );
        expect(getter.child.value).toBe(1);
        expect(getter.child.value).toBe(2);
    });
});
