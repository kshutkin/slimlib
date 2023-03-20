import { generate, generateGlobals, reset, rootMock } from '../src';

describe('smart-mock', () => {

    afterEach(() => {
        reset();
    });

    it('smoke', () => {
        expect(rootMock).toBeDefined();
    });

    describe('basics for generate', () => {
        it('name', () => {
            expect(generate(rootMock({}, 'test'))).toEqual('test');
        });
    
        it('property', () => {
            expect(generate(rootMock({ ok: {} }, 'test').ok)).toEqual('test.ok');
        });
    
        it('call', () => {
            expect(generate(rootMock({ ok: () => ({}) }, 'test').ok())).toEqual('test.ok()');
        });
    
        it('call with parameters', () => {
            expect(generate(rootMock({ ok: (arg: { some: number }) => ({ arg }) }, 'test').ok({ some: 1 }))).toEqual('test.ok({some:1})');
        });

        it('root call', () => {
            expect(generate(rootMock(() => ({}), 'test')())).toEqual('test()');
        });
    });

    describe('complex', () => {
        it('two uses after call', () => {
            const factory = rootMock(() => ({ api: { addInstance: () => ({}) } }), 'test');
            const instance = factory();
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_0 = test()');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
        });

        it('with global arguments', () => {
            const factory = rootMock((arg: { test: 1 }) => ({ api: { addInstance: () => ({ arg }) } }), 'test');
            const instance = factory({ test: 1 });
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_0 = test({test:1})');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
        });

        it('with global getter in between', () => {
            const factory = rootMock({ test: () => ({ api: { addInstance: () => ({}) } }) }, 'test');
            const instance = factory.test();
            const secondInstance = instance.api.addInstance();
            const result = generate([instance, secondInstance]);
            expect(generateGlobals()).toEqual('const tmp_1 = test.test\nconst tmp_0 = tmp_1()');
            expect(result).toEqual('[tmp_0,tmp_0.api.addInstance()]');
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
            expect(generate('test' as never as object)).toEqual('test');
        });
    });
    
});

