import createRecordingMockFactory from '../src';

describe('smart-mock', () => {

    let createMock: ReturnType<typeof createRecordingMockFactory>['createMock'],
        generate: ReturnType<typeof createRecordingMockFactory>['generate'],
        generateGlobals: ReturnType<typeof createRecordingMockFactory>['generateGlobals'];

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
            expect(generate(createMock({ a: false }, 'test').a as never as object)).toEqual(false);
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
            expect(generate(createMock({ ok: (arg: { some: number }) => ({ arg }) }, 'test').ok({ some: 1 }))).toEqual('test.ok({some:1})');
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
            const factory = createMock((arg: { test: 1 }) => ({ api: { addInstance: () => ({ arg }) } }), 'test');
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
            const Factory = createMock(class Test { constructor(public name: string) {} }, 'Test');
            const instance = new Factory('test123');
            const result = generate(instance);
            expect(result).toEqual('new Test("test123")');
        });

        it('new global', () => {
            const Factory = createMock(class Test { constructor(public name: string) {} }, 'Test');
            const instance = new Factory('test123');
            instance.name = 'test2';
            const result = generate(instance);
            const globals = generateGlobals();
            expect(globals).toEqual('const tmp_0 = new Test("test123")\ntmp_0.name = "test2"');
            expect(result).toEqual('tmp_0');
        });

        it('Reflect.construct', () => {
            const Factory = createMock(class Test { constructor(public name: string) {} }, 'Test');
            const Factory2 = createMock(class Test2 { constructor(public name: string) {} }, 'Test2');
            const instance = Reflect.construct(Factory, ['Tesst'], Factory2);
            const result = generate(instance);
            expect(result).toEqual('Reflect.construct(Test,["Tesst"],Test2)');
        });

        it('Reflect.construct global', () => {
            const Factory = createMock(class Test { constructor(public name: string) {} }, 'Test');
            const Factory2 = createMock(class Test2 { constructor(public name: string) {} }, 'Test2');
            const instance = Reflect.construct(Factory, ['Tesst'], Factory2);
            instance.name = 'test2';
            const result = generate(instance);
            const globals = generateGlobals();
            expect(globals).toEqual('const tmp_0 = Reflect.construct(Test,["Tesst"],Test2)\ntmp_0.name = "test2"');
            expect(result).toEqual('tmp_0');
        });
    });

    describe('imperative', () => {
        it('set', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            (instance as {value: number}).value = 10;
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\ntmp_0.value = 10');
            expect(result).toEqual('tmp_0');
        });

        xit('defineProperty', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            Object.defineProperty(instance, 'property1', {
                value: 42,
                writable: false
            });
            const result = generate(instance);
            expect(generateGlobals()).toEqual('const tmp_0 = test()\nObject.defineProperty(tmp_0, "property1", {value:42,writable:false})');
            expect(result).toEqual('tmp_0');
        });

        it('delete', () => {
            const factory = createMock(() => ({}), 'test');
            const instance = factory();
            delete (instance as any)['property1'];
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
            expect(generate(null as never as object)).toEqual(null);
        });

        it('undefined', () => {
            expect(generate(undefined as never as object)).toEqual(undefined);
        });

        it('false', () => {
            expect(generate(false as never as object)).toEqual(false);
        });

        it('true', () => {
            expect(generate(true as never as object)).toEqual(true);
        });

        it('function', () => {
            expect(generate((() => ({})) as never as object)).toEqual('() => ({})');
        });

        it('RegEx', () => {
            expect(generate(/abc/ as never as object)).toEqual(/abc/);
        });

        it('string', () => {
            expect(generate('test' as never as object)).toEqual('"test"');
        });
    });

    describe('unwrapValue', () => {
        xit('able to unwrap value', async () => {
            const mock = createMock({} as {prop?: object}, 'test');
            const emptyObject = {};
            mock.prop = emptyObject;
            expect(mock.prop).not.toBe(emptyObject);
            // expect(unwrapValue(mock.prop)).toBe(emptyObject);
        });
    });
    
});

