import { createStoreFactory, unwrapValue } from '../src';
import util from 'util';

const createStore = createStoreFactory(false);
const createStoreWithNofificationAboutInitialState = createStoreFactory(true);

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('store', () => {

    it('smoke', () => {
        expect(createStoreFactory).toBeDefined();
    });

    describe('change detection', () => {
        it('string', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: 'test2'
            }));
            expect(store().prop).toBe('test2');
            expect(state.prop).toBe('test2');
        });

        it('number', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 3});
            store(subscriber);
            state.prop = 42;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: 42
            }));
            expect(store().prop).toBe(42);
            expect(state.prop).toBe(42);
        });

        it('boolean', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: false});
            store(subscriber);
            state.prop = true;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: true
            }));
            expect(store().prop).toBe(true);
            expect(state.prop).toBe(true);
        });

        it('1 => null', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<{prop: null | number}>({prop: 1});
            store(subscriber);
            state.prop = null;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: null
            }));
            expect(store().prop).toBe(null);
            expect(state.prop).toBe(null);
        });

        it('1 => undefined', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<{prop: undefined | number}>({prop: 1});
            store(subscriber);
            state.prop = undefined;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: undefined
            }));
            expect(store().prop).toBe(undefined);
            expect(state.prop).toBe(undefined);
        });

        it('object', async () => {
            const subscriber = jest.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [state, store] = createStore<any>({prop: { a: 1 }});
            store(subscriber);
            state.prop = { b: 2 };
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: { b: 2 }
            }));
            expect(store().prop).toEqual({ b: 2 });
            expect(state.prop).toEqual({ b: 2 });
        });

        it('array', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<number[]>([]);
            store(subscriber);
            state.push(42);
            await flushPromises();
            expect(subscriber).toBeCalledWith([42]);
            expect(store()).toEqual([42]);
            expect(state).toEqual([42]);
        });

        it('RegExp',  () => {
            const [state, store] = createStore({prop: /abc/});
            expect(store()).toEqual({prop: /abc/});
            expect(state.prop.test('abc')).toBeTruthy();
        });

        it('define writable property on Proxy', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<{prop?: number}>({});
            store(subscriber);
            Object.defineProperty(state, 'prop', {
                value: 42,
                writable: true
            });
            await flushPromises();
            state.prop = 24;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: 24
            }));
            expect(store().prop).toBe(24);
            expect(state.prop).toBe(24);
        });

        it('define property on Proxy', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<{prop?: number}>({});
            store(subscriber);
            Object.defineProperty(state, 'prop', {
                value: 42
            });
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: 42
            }));
            expect(store().prop).toBe(42);
            expect(state.prop).toBe(42);
        });

        it('define non configurable property on initial state', () => {
            const initialState = {};
            Object.defineProperty(initialState, 'prop', {
                configurable: false,
                value: 42
            });
            const [state, store] = createStore<{prop?: number}>(initialState);
            expect(() => {
                state.prop = 24;
            }).toThrow();
            expect(store().prop).toBe(42);
            expect(state.prop).toBe(42);
        });

        it('allows iteration over array', () => {
            const [state] = createStore<number[]>([1, 2, 3]);
            let summ = 0;
            expect(() => {
                for (const i of state) {
                    summ += i;
                }
            }).not.toThrow();
            expect(summ).toBe(6);
        });

        it('no changes', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(0);
        });

        it('triggers once per action', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            state.prop = 'test3';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(1);
        });

        it('nested object', async () => {
            const subscriber = jest.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [state, store] = createStore<any>({prop: { a: 1 }});
            store(subscriber);
            state.prop.a = 2;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({
                prop: { a: 2 }
            }));
            expect(store().prop).toEqual({ a: 2 });
            expect(state.prop).toEqual({ a: 2 });
        });

        it('handles delete property', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore<{prop?: number}>({prop: 42});
            store(subscriber);
            delete state.prop;
            await flushPromises();
            expect(subscriber).toBeCalledWith(expect.objectContaining({}));
            expect(store().prop).toBe(undefined);
            expect(state.prop).toBe(undefined);
        });

        it('reuse object', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore([{prop: 42}]);
            store(subscriber);
            state.push(state[0] as {prop: number});
            await flushPromises();
            expect(subscriber).toBeCalledWith([{prop: 42},{prop: 42}]);
            expect(store()).toEqual([{prop: 42},{prop: 42}]);
            expect(state).toEqual([{prop: 42},{prop: 42}]);
            expect(store().every(item => !util.types.isProxy(item))).toBeTruthy();
        });

        it('change object in array', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({data:[{prop: ''}]});
            store(subscriber);
            (state.data[0] as {prop: string}).prop += 'test';
            await flushPromises();
            expect(subscriber).toBeCalledWith({data:[{prop: 'test'}]});
            expect(store()).toEqual({data:[{prop: 'test'}]});
            expect(state).toEqual({data:[{prop: 'test'}]});
        });

        it('find index in array (only wrappers)', () => {
            const [state] = createStore({data:[{prop: ''}]});
            const index = state.data.indexOf(state.data[0] as {prop: string});
            expect(index).toBe(0);
        });

        // it('find index in array (mixed objects)', () => {
        //     const [state, store] = createStore({data:[{prop: ''}]});
        //     const index = state.data.indexOf(store().data[0]);
        //     expect(index).toBe(0);
        // });

        it('swap in array', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({data:[{prop: '1'},{prop: '2'}]});
            store(subscriber);
            const temp = state.data[0] as {prop: string};
            (state.data[0] as {prop: string}) = state.data[1] as {prop: string};
            (state.data[1] as {prop: string}) = temp;
            await flushPromises();
            expect(subscriber).toBeCalledWith({data:[{prop: '2'},{prop: '1'}]});
            expect(store()).toEqual({data:[{prop: '2'},{prop: '1'}]});
            expect(state).toEqual({data:[{prop: '2'},{prop: '1'}]});
        });

        it('Object.assign (proxy as a target, no new properties)', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({test: false});
            store(subscriber);
            Object.assign(state, {test: true});
            await flushPromises();
            expect(subscriber).toBeCalledWith({test: true});
            expect(store()).toEqual({test: true});
            expect(state).toEqual({test: true});
        });

        it('Object.assign (proxy as a target)', async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({data: false});
            store(subscriber);
            Object.assign(state, {test: true});
            await flushPromises();
            expect(subscriber).toBeCalledWith({data: false, test: true});
            expect(store()).toEqual({data: false, test: true});
            expect(state).toEqual({data: false, test: true});
        });

        it('Object.assign (proxy as a source)', () => {
            const [state] = createStore({data: false});
            const target = {};
            Object.assign(target, state);
            expect(target).toEqual({data: false});
        });
    });

    describe('publish/subscribe pattern', () => {
        it('one subscriber',async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(1);
        });

        it('unsubscribe',async () => {
            const subscriber = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            const unsub = store(subscriber);
            unsub();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(0);
        });

        it('multiple subscribers',async () => {
            const subscriber = jest.fn();
            const subscriber2 = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            store(subscriber2);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(1);
            expect(subscriber2).toBeCalledTimes(1);
        });

        it('multiple subscribers (unsubscribe one)',async () => {
            const subscriber = jest.fn();
            const subscriber2 = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            store(subscriber2)();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(1);
            expect(subscriber2).toBeCalledTimes(0);
        });

        it('multiple subscribers (unsubscribe all)',async () => {
            const subscriber = jest.fn();
            const subscriber2 = jest.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber)();
            store(subscriber2)();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toBeCalledTimes(0);
            expect(subscriber2).toBeCalledTimes(0);
        });
    });
});

describe('store with initial notification', () => {
    it('notifies after creation', async () => {
        const subscriber = jest.fn();
        const [, store] = createStoreWithNofificationAboutInitialState({prop: 'test'});
        store(subscriber);
        await flushPromises();
        expect(subscriber).toBeCalledTimes(1);
        expect(subscriber).toBeCalledWith({prop: 'test'});
    });

    it('deafult state', async () => {
        const subscriber = jest.fn();
        const [, store] = createStoreWithNofificationAboutInitialState();
        store(subscriber);
        await flushPromises();
        expect(subscriber).toBeCalledTimes(1);
        expect(subscriber).toBeCalledWith({});
    });
});

describe('unwrapValue', () => {
    it('able to unwrap value', async () => {
        const [state] = createStore({} as {prop?: object});
        const emptyObject = {};
        state.prop = emptyObject;
        expect(state.prop).not.toBe(emptyObject);
        expect(unwrapValue(state.prop)).toBe(emptyObject);
    });
});

describe('notification', () => {
    it('able to notify subscribers', async () => {
        const [, store, notify] = createStore({});
        const listener = jest.fn();
        store(listener);
        notify();
        await flushPromises();
        expect(listener).toBeCalledTimes(1);
    });
    it('notify twice', async () => {
        const [, store, notify] = createStore({});
        const listener = jest.fn();
        store(listener);
        notify();
        notify();
        await flushPromises();
        expect(listener).toBeCalledTimes(1);
    });
});
