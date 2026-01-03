import { beforeEach, describe, expect, it } from 'vitest';

import createRecordingMockFactory from '../src/index.js';

describe('smart-mock', () => {
    /** @type {ReturnType<typeof createRecordingMockFactory>['createMock']} */
    let createMock;
    /** @type {ReturnType<typeof createRecordingMockFactory>['generate']} */
    let generate;
    /** @type {ReturnType<typeof createRecordingMockFactory>['generateGlobals']} */
    let generateGlobals;

    beforeEach(() => {
        const factory = createRecordingMockFactory();
        createMock = factory.createMock;
        generate = factory.generate;
        generateGlobals = factory.generateGlobals;
    });

    it('smoke', () => {
        expect(createMock).toBeDefined();
    });

    describe('basics for generate', () => {
        it('primitive', () => {
            expect(generate(/** @type {never} */ (createMock({ a: false }, 'test').a))).toEqual(false);
        });

        it('name', () => {
            expect(generate(createMock({}, 'test'))).toEqual('test');
        });

        it('property', () => {
            expect(generate(createMock({ ok: {} }, 'test').ok)).toEqual('test.ok');
        });

        it('call', () => {
            expect(generate(createMock({ ok: () => ({}) }, 'test').ok())).toEqual('test.ok()');
        });

        it('call with parameters', () => {
            expect(generate(createMock({ ok: (/** @type {{ some: number }} */ arg) => ({ arg }) }, 'test').ok({ some: 1 }))).toEqual(
                'test.ok({some:1})'
            );
        });

        it('root call', () => {
            expect(generate(createMock(() => ({}), 'test')())).toEqual('test()');
        });
    });

    describe('complex', () => {
        it('two uses after call', () => {
            const factory = createMock(() => ({ api: { addInstance: () => ({}) } }), 'test');
            const instance = factory();
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_0 = test()');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
        });

        it('with global arguments', () => {
            const factory = createMock((/** @type {{ test: 1 }} */ arg) => ({ api: { addInstance: () => ({ arg }) } }), 'test');
            const instance = factory({ test: 1 });
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_0 = test({test:1})');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
        });

        it('with global getter in between', () => {
            const factory = createMock({ test: () => ({ api: { addInstance: () => ({}) } }) }, 'test');
            const instance = factory.test();
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_1 = test.test\nconst tmp_0 = tmp_1()');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
        });

        it('new', () => {
            const Factory = createMock(
                class Test {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test'
            );
            const instance = new Factory('test123');
            const result = generate(instance);
            expect(result).toEqual('new Test("test123")');
        });

        it('new global', () => {
            const Factory = createMock(
                class Test {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test'
            );
            const instance = new Factory('test123');
            instance.name = 'test2';
            const result = generate(instance);
            const globals = generateGlobals();
            expect(globals).toEqual('const tmp_0 = new Test("test123")\ntmp_0.name = "test2"');
            expect(result).toEqual('tmp_0');
        });

        it('Reflect.construct', () => {
            const Factory = createMock(
                class Test {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test'
            );
            const Factory2 = createMock(
                class Test2 {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test2'
            );
            const instance = Reflect.construct(Factory, ['Tesst'], Factory2);
            const result = generate(instance);
            expect(result).toEqual('Reflect.construct(Test,["Tesst"],Test2)');
        });

        it('Reflect.construct global', () => {
            const Factory = createMock(
                class Test {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test'
            );
            const Factory2 = createMock(
                class Test2 {
                    /** @param {string} name */
                    constructor(name) {
                        /** @type {string} */
                        this.name = name;
                    }
                },
                'Test2'
            );
            const instance = Reflect.construct(Factory, ['Tesst'], Factory2);
            instance.name = 'test2';
            const result = generate(instance);
            const globals = generateGlobals();
            expect(globals).toEqual('const tmp_0 = Reflect.construct(Test,["Tesst"],Test2)\ntmp_0.name = "test2"');
            expect(result).toEqual('tmp_0');
        });

        it('curry', () => {
            const curry = createMock(() => {
                return () => () => undefined;
            }, 'curry');
            // @ts-expect-error
            const result = generate(curry(() => undefined)('arg'));
            // esbuild may transform `undefined` to `void 0`
            expect(result).toMatch(/^curry\(\(\) => (?:undefined|void 0)\)\("arg"\)$/);
        });
    });

    describe('imperative', () => {
        it('set', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            /** @type {any} */ (instance).value = 10;
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\ntmp_0.value = 10');
            expect(result).toEqual('tmp_0');
        });

        it.skip('defineProperty', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            Object.defineProperty(instance, 'property1', {
                value: 42,
                writable: false,
            });
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\nObject.defineProperty(tmp_0, "property1", {value:42,writable:false})');
            expect(result).toEqual('tmp_0');
        });

        it('delete', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            // biome-ignore lint/complexity/useLiteralKeys: testing bracket notation specifically
            delete (/** @type {any} */ (instance)['property1']);
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\ndelete tmp_0["property1"]');
            expect(result).toEqual('tmp_0');
        });

        it('setPrototypeOf', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            Object.setPrototypeOf(instance, {});
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\nObject.setPrototypeOf(tmp_0, {})');
            expect(result).toEqual('tmp_0');
        });

        it('setPrototypeOf + another mock', () => {
            const factory = createMock(() => ({}), 'test');
            const test2 = createMock({}, 'test2');
            const instance = factory();
            Object.setPrototypeOf(instance, test2);
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\nObject.setPrototypeOf(tmp_0, test2)');
            expect(result).toEqual('tmp_0');
        });

        it('preventExtensions', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            Object.preventExtensions(instance);
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\nObject.preventExtensions(tmp_0)');
            expect(result).toEqual('tmp_0');
        });
    });

    describe('stringify', () => {
        it('null', () => {
            expect(generate(/** @type {never} */ (null))).toEqual(null);
        });

        it('undefined', () => {
            expect(generate(/** @type {never} */ (undefined))).toEqual(undefined);
        });

        it('false', () => {
            expect(generate(/** @type {never} */ (false))).toEqual(false);
        });

        it('true', () => {
            expect(generate(/** @type {never} */ (true))).toEqual(true);
        });

        it('function', () => {
            expect(generate(/** @type {never} */ (() => ({})))).toEqual('() => ({})');
        });

        it('RegEx', () => {
            expect(generate(/** @type {never} */ (/abc/))).toEqual(/abc/);
        });

        it('string', () => {
            expect(generate(/** @type {never} */ ('test'))).toEqual('"test"');
        });
    });

    describe('unwrapValue', () => {
        it.skip('able to unwrap value', async () => {
            const mock = createMock(/** @type {{prop?: object}} */ ({}), 'test');
            const emptyObject = {};
            mock.prop = emptyObject;
            expect(mock.prop).not.toBe(emptyObject);
            // expect(unwrapValue(mock.prop)).toBe(emptyObject);
        });
    });

    describe('combinations', () => {
        it('call + assigment on root', () => {
            const mock = createMock(
                {
                    name: '',
                    test() {
                        /**/
                    },
                },
                'mock'
            );

            mock.test();
            mock.name = 'some name';

            const result = generate(mock);
            const globals = generateGlobals();
            expect(result).toEqual('mock');
            expect(globals).toEqual('mock.name = "some name"\nconst tmp_0 = mock.test\ntmp_0()');
        });

        it('call with result as exit + assigment on root', () => {
            const mock = createMock(
                {
                    name: '',
                    test() {
                        return {};
                    },
                },
                'mock'
            );

            const testMethodResult = mock.test();
            mock.name = 'some name';

            const result = generate(testMethodResult);
            const globals = generateGlobals();
            expect(result).toEqual('mock.test()');
            expect(globals).toEqual('mock.name = "some name"');
        });
    });
});
