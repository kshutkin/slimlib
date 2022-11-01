import createInject, { type Provider } from '../src';

describe('createInject', () => {

    it('smoke', () => {
        expect(createInject).toBeDefined();
    });

    it('provide / inject', () => {
        const inject = createInject();

        inject(($provide: Provider) => {
            $provide('value', 'test');
        });

        const value = inject((value: string) => {
            return value;
        });

        expect(value).toEqual('test');
    });
});