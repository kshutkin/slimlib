import { describe, it, expect, vi } from 'vitest';
import { createStoreFactory, unwrapValue } from '../src';
import util from 'util';

const createStore = createStoreFactory();

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('store', () => {

    it('smoke', () => {
        expect(createStoreFactory).toBeDefined();
    });

    describe('change detection', () => {
        it('string', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: 'test2'
            }));
            expect(store().prop).toBe('test2');
            expect(state.prop).toBe('test2');
        });

        it('number', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 3});
            store(subscriber);
            state.prop = 42;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: 42
            }));
            expect(store().prop).toBe(42);
            expect(state.prop).toBe(42);
        });

        it('boolean', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: false});
            store(subscriber);
            state.prop = true;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: true
            }));
            expect(store().prop).toBe(true);
            expect(state.prop).toBe(true);
        });

        it('1 => null', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<{prop: null | number}>({prop: 1});
            store(subscriber);
            state.prop = null;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: null
            }));
            expect(store().prop).toBe(null);
            expect(state.prop).toBe(null);
        });

        it('1 => undefined', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<{prop: undefined | number}>({prop: 1});
            store(subscriber);
            state.prop = undefined;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: undefined
            }));
            expect(store().prop).toBe(undefined);
            expect(state.prop).toBe(undefined);
        });

        it('object', async () => {
            const subscriber = vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [state, store] = createStore<any>({prop: { a: 1 }});
            store(subscriber);
            state.prop = { b: 2 };
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: { b: 2 }
            }));
            expect(store().prop).toEqual({ b: 2 });
            expect(state.prop).toEqual({ b: 2 });
        });

        it('array', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<number[]>([]);
            store(subscriber);
            state.push(42);
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith([42]);
            expect(store()).toEqual([42]);
            expect(state).toEqual([42]);
        });

        it('RegExp',  () => {
            const [state, store] = createStore({prop: /abc/});
            expect(store()).toEqual({prop: /abc/});
            expect(state.prop.test('abc')).toBeTruthy();
        });

        it('define writable property on Proxy', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<{prop?: number}>({});
            store(subscriber);
            Object.defineProperty(state, 'prop', {
                value: 42,
                writable: true
            });
            await flushPromises();
            state.prop = 24;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: 24
            }));
            expect(store().prop).toBe(24);
            expect(state.prop).toBe(24);
        });

        it('define property on Proxy', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<{prop?: number}>({});
            store(subscriber);
            Object.defineProperty(state, 'prop', {
                value: 42
            });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
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
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(0);
        });

        it('triggers once per action', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            state.prop = 'test3';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('nested object', async () => {
            const subscriber = vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [state, store] = createStore<any>({prop: { a: 1 }});
            store(subscriber);
            state.prop.a = 2;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({
                prop: { a: 2 }
            }));
            expect(store().prop).toEqual({ a: 2 });
            expect(state.prop).toEqual({ a: 2 });
        });

        it('handles delete property', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore<{prop?: number}>({prop: 42});
            store(subscriber);
            delete state.prop;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({}));
            expect(store().prop).toBe(undefined);
            expect(state.prop).toBe(undefined);
        });

        it('reuse object', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore([{prop: 42}]);
            store(subscriber);
            state.push(state[0] as {prop: number});
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith([{prop: 42},{prop: 42}]);
            expect(store()).toEqual([{prop: 42},{prop: 42}]);
            expect(state).toEqual([{prop: 42},{prop: 42}]);
            expect(store().every(item => !util.types.isProxy(item))).toBeTruthy();
        });

        it('change object in array', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({data:[{prop: ''}]});
            store(subscriber);
            (state.data[0] as {prop: string}).prop += 'test';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({data:[{prop: 'test'}]});
            expect(store()).toEqual({data:[{prop: 'test'}]});
            expect(state).toEqual({data:[{prop: 'test'}]});
        });

        it('find index in array (only wrappers)', () => {
            const [state] = createStore({data:[{prop: ''}]});
            const index = state.data.indexOf(state.data[0] as {prop: string});
            expect(index).toBe(0);
        });

        it('Map in store', () => {
            const [state] = createStore(new Map([['prop', 'test']]));
            expect(state.get('prop')).toBe('test');
        });

        it('Map in store (set value)', async () => {
            const subscriber = vi.fn();
            const value = new Map([['prop', 'test']]);
            const [state, store] = createStore(value);
            store(subscriber);
            state.set('prop', 'test2');
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(value);
        });

        it('Map in store (get value)', async () => {
            const subscriber = vi.fn();
            const value = new Map([['prop', 'test']]);
            const [state, store] = createStore(value);
            store(subscriber);
            const size = state.size;
            await flushPromises();
            expect(size).toBe(1);
        });

        it('second level proxy triggers subscriber', async () => {
            const subscriber = vi.fn();
            const value = {prop: { value: { value2: 1}}};
            const [state, store] = createStore(value);
            const prop = state.prop.value;
            await flushPromises();
            store(subscriber);
            prop.value2 = 2;
            await flushPromises();
            expect(unwrapValue(prop) !== prop).toBeTruthy();
            expect(subscriber).toHaveBeenCalledWith(value);
        });

        it('find index in array (mixed objects)', () => {
            const [state, store] = createStore({data:[{prop: ''}]});
            const index = state.data.indexOf(store().data[0]!);
            expect(index).toBe(0);
        });

        it('swap in array', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({data:[{prop: '1'},{prop: '2'}]});
            store(subscriber);
            const temp = state.data[0] as {prop: string};
            (state.data[0] as {prop: string}) = state.data[1] as {prop: string};
            (state.data[1] as {prop: string}) = temp;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({data:[{prop: '2'},{prop: '1'}]});
            expect(store()).toEqual({data:[{prop: '2'},{prop: '1'}]});
            expect(state).toEqual({data:[{prop: '2'},{prop: '1'}]});
        });

        it('Object.assign (proxy as a target, no new properties)', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({test: false});
            store(subscriber);
            Object.assign(state, {test: true});
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({test: true});
            expect(store()).toEqual({test: true});
            expect(state).toEqual({test: true});
        });

        describe('function proxying through proxy', () => {
            // Testing all 12 combinations:
            // - Property location: own property vs prototype
            // - Function type: arrow function vs classic function
            // - Call method: normal call (object.func()), no this (extracted), new this (.call/.apply)

            describe('own property + arrow function', () => {
                // Note: Arrow functions capture `this` lexically from their definition scope,
                // so the proxy's .apply(target, ...) has no effect on them. We cannot verify
                // `this` binding for arrow functions since they ignore it entirely.

                it('normal call (object.func notation)', () => {
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        // Arrow functions ignore `this` - they use lexical scope instead
                        receivedArgs = [a, b];
                        return 'arrow-result';
                    };
                    const [state] = createStore({ func: arrowFunc, value: 42 });
                    const result = state.func(1, 'test');
                    expect(result).toBe('arrow-result');
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([1, 'test']);
                });

                it('no this (extracted call)', () => {
                    // Arrow functions ignore `this` regardless of how they're called
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        receivedArgs = [a, b];
                        return 'arrow-result';
                    };
                    const [state] = createStore({ func: arrowFunc, value: 42 });
                    const extracted = state.func;
                    const result = extracted(2, 'extracted');
                    expect(result).toBe('arrow-result');
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([2, 'extracted']);
                });

                it('new this (.call/.apply)', () => {
                    // Arrow functions ignore `this` even when .call/.apply is used
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        receivedArgs = [a, b];
                        return 'arrow-result';
                    };
                    const [state] = createStore({ func: arrowFunc, value: 42 });
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 3, 'call');
                    expect(result).toBe('arrow-result');
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([3, 'call']);
                });
            });

            describe('own property + classic function', () => {
                it('normal call (object.func notation)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'classic-result';
                    };
                    const obj = { func: classicFunc, value: 42 };
                    const [state] = createStore(obj);
                    const result = state.func(10, 'normal');
                    expect(result).toBe('classic-result');
                    // Verify: The proxy applies the function with target (original unwrapped object) as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([10, 'normal']);
                });

                it('no this (extracted call)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'classic-result';
                    };
                    const obj = { func: classicFunc, value: 42 };
                    const [state] = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(20, 'extracted');
                    expect(result).toBe('classic-result');
                    // Verify: Even when extracted, the proxy wrapper applies with target (original object) as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([20, 'extracted']);
                });

                it('new this (.call/.apply)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'classic-result';
                    };
                    const obj = { func: classicFunc, value: 42 };
                    const [state] = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 30, 'call');
                    expect(result).toBe('classic-result');
                    // Verify: The proxy ignores the provided newThis and uses target (original object) instead
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(newThis); // Ignores the custom this
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([30, 'call']);
                });
            });

            describe('prototype + arrow function', () => {
                // Note: Arrow functions capture `this` lexically from their definition scope,
                // so the proxy's .apply(target, ...) has no effect on them. We cannot verify
                // `this` binding for arrow functions since they ignore it entirely.

                it('normal call (object.func notation)', () => {
                    // Arrow functions ignore `this` regardless of call method
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow-result';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const result = state.func(100, 'proto-normal');
                    expect(result).toBe('proto-arrow-result');
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([100, 'proto-normal']);
                });

                it('no this (extracted call)', () => {
                    // Arrow functions ignore `this` regardless of call method
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow-result';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(200, 'proto-extracted');
                    expect(result).toBe('proto-arrow-result');
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([200, 'proto-extracted']);
                });

                it('new this (.call/.apply)', () => {
                    // Arrow functions ignore `this` even when .call/.apply is used
                    let receivedArgs: unknown[] = [];
                    const arrowFunc = (a: number, b: string) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow-result';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 300, 'proto-call');
                    expect(result).toBe('proto-arrow-result');
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([300, 'proto-call']);
                });
            });

            describe('prototype + classic function', () => {
                it('normal call (object.func notation)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic-result';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const result = state.func(1000, 'proto-classic-normal');
                    expect(result).toBe('proto-classic-result');
                    // Verify: The proxy applies with target (obj, not proto) as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(proto); // Not the prototype
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([1000, 'proto-classic-normal']);
                });

                it('no this (extracted call)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic-result';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(2000, 'proto-classic-extracted');
                    expect(result).toBe('proto-classic-result');
                    // Verify: Even when extracted, the proxy wrapper applies with target (original object) as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(proto); // Not the prototype
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([2000, 'proto-classic-extracted']);
                });

                it('new this (.call/.apply)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic-result';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string; value: number };
                    obj.value = 42;
                    const [state] = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 3000, 'proto-classic-call');
                    expect(result).toBe('proto-classic-result');
                    // Verify: The proxy ignores the provided newThis and uses target (original object) instead
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(newThis); // Ignores the custom this
                    expect(capturedThis).not.toBe(proto); // Not the prototype
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([3000, 'proto-classic-call']);
                });
            });

            describe('class with classic methods', () => {
                it('normal call (object.method notation)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method(a: number, b: string) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-method-result';
                        }
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const result = state.method(10, 'class-normal');
                    expect(result).toBe('class-method-result');
                    // Verify: The proxy applies the function with target (original instance) as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([10, 'class-normal']);
                });

                it('no this (extracted call)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method(a: number, b: string) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-method-result';
                        }
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const extracted = state.method;
                    const result = extracted(20, 'class-extracted');
                    expect(result).toBe('class-method-result');
                    // Verify: Even when extracted, the proxy wrapper applies with target as this
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([20, 'class-extracted']);
                });

                it('new this (.call/.apply)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method(a: number, b: string) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-method-result';
                        }
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.method.call(newThis, 30, 'class-call');
                    expect(result).toBe('class-method-result');
                    // Verify: The proxy ignores the provided newThis and uses target instead
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(newThis); // Ignores the custom this
                    expect(capturedThis).not.toBe(state); // Not the proxy
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([30, 'class-call']);
                });

                it('method can access instance properties via this', () => {
                    class MyClass {
                        value = 42;
                        getValue() {
                            return this.value;
                        }
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const result = state.getValue();
                    // Verify: Method can access instance properties through this
                    expect(result).toBe(42);
                });
            });

            describe('class with member arrow functions', () => {
                // Note: Arrow function class members capture `this` lexically (the instance),
                // so the proxy's .apply(target, ...) has no effect on them.
                // However, since they're defined in the constructor with the instance as `this`,
                // they will correctly reference the original instance.

                it('normal call (object.method notation)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method = (a: number, b: string) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-arrow-result';
                        };
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const result = state.method(100, 'class-arrow-normal');
                    expect(result).toBe('class-arrow-result');
                    // Arrow functions capture `this` lexically - it's the original instance
                    expect(capturedThis).toBe(obj);
                    // Verify: Arguments are passed correctly
                    expect(receivedArgs).toEqual([100, 'class-arrow-normal']);
                });

                it('no this (extracted call)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method = (a: number, b: string) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-arrow-result';
                        };
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const extracted = state.method;
                    const result = extracted(200, 'class-arrow-extracted');
                    expect(result).toBe('class-arrow-result');
                    // Arrow functions capture `this` lexically - still the original instance
                    expect(capturedThis).toBe(obj);
                    // Verify: Arguments are passed correctly even when extracted
                    expect(receivedArgs).toEqual([200, 'class-arrow-extracted']);
                });

                it('new this (.call/.apply)', () => {
                    let capturedThis: unknown = null;
                    let receivedArgs: unknown[] = [];
                    class MyClass {
                        value = 42;
                        method = (a: number, b: string) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-arrow-result';
                        };
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.method.call(newThis, 300, 'class-arrow-call');
                    expect(result).toBe('class-arrow-result');
                    // Arrow functions ignore .call/.apply for `this` - still the original instance
                    expect(capturedThis).toBe(obj);
                    expect(capturedThis).not.toBe(newThis); // Ignores the custom this
                    // Verify: Arguments are passed correctly even with .call
                    expect(receivedArgs).toEqual([300, 'class-arrow-call']);
                });

                it('arrow method can access instance properties via this', () => {
                    class MyClass {
                        value = 42;
                        getValue = () => {
                            return this.value;
                        };
                    }
                    const obj = new MyClass();
                    const [state] = createStore(obj);
                    const result = state.getValue();
                    // Verify: Arrow method can access instance properties through lexical this
                    expect(result).toBe(42);
                });
            });

            describe('function proxying with arguments', () => {
                it('passes arguments correctly for own property classic function', () => {
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        receivedArgs = [a, b];
                        return a + b;
                    };
                    const obj = { func: classicFunc };
                    const [state] = createStore(obj);
                    const result = state.func(42, 'test');
                    expect(result).toBe('42test');
                    expect(receivedArgs).toEqual([42, 'test']);
                });

                it('passes arguments correctly for prototype classic function', () => {
                    let receivedArgs: unknown[] = [];
                    const classicFunc = function(this: unknown, a: number, b: string) {
                        receivedArgs = [a, b];
                        return a + b;
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto) as { func: (a: number, b: string) => string };
                    const [state] = createStore(obj);
                    const result = state.func(42, 'test');
                    expect(result).toBe('42test');
                    expect(receivedArgs).toEqual([42, 'test']);
                });

                it('unwraps proxy arguments when calling function', async () => {
                    let receivedArg: unknown = null;
                    const classicFunc = function(this: unknown, arg: object) {
                        receivedArg = arg;
                    };
                    const innerObj = { inner: true };
                    const obj = { func: classicFunc, nested: innerObj };
                    const [state] = createStore(obj);
                    // Pass the proxied nested object as argument
                    state.func(state.nested);
                    // The argument should be unwrapped to the original object
                    expect(receivedArg).toBe(innerObj);
                });
            });

            describe('function proxying triggers notification', () => {
                it('calling function through proxy triggers notification', async () => {
                    const subscriber = vi.fn();
                    const classicFunc = function(this: unknown) {
                        return 'result';
                    };
                    const obj = { func: classicFunc, value: 42 };
                    const [state, store] = createStore(obj);
                    store(subscriber);
                    state.func();
                    await flushPromises();
                    expect(subscriber).toHaveBeenCalledTimes(1);
                });

                it('calling prototype function through proxy triggers notification', async () => {
                    const subscriber = vi.fn();
                    const classicFunc = function(this: unknown) {
                        return 'result';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto) as { func: () => string; value: number };
                    obj.value = 42;
                    const [state, store] = createStore(obj);
                    store(subscriber);
                    state.func();
                    await flushPromises();
                    expect(subscriber).toHaveBeenCalledTimes(1);
                });
            });
        });

        it('Object.assign (proxy as a target)', async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({data: false});
            store(subscriber);
            Object.assign(state, {test: true});
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({data: false, test: true});
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
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('unsubscribe',async () => {
            const subscriber = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            const unsub = store(subscriber);
            unsub();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(0);
        });

        it('multiple subscribers',async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            store(subscriber2);
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(1);
        });

        it('multiple subscribers (unsubscribe one)',async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber);
            store(subscriber2)();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(0);
        });

        it('multiple subscribers (unsubscribe all)',async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const [state, store] = createStore({prop: 'test'});
            store(subscriber)();
            store(subscriber2)();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(0);
            expect(subscriber2).toHaveBeenCalledTimes(0);
        });
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
        const listener = vi.fn();
        store(listener);
        notify();
        await flushPromises();
        expect(listener).toHaveBeenCalledTimes(1);
    });
    it('notify twice', async () => {
        const [, store, notify] = createStore({});
        const listener = vi.fn();
        store(listener);
        notify();
        notify();
        await flushPromises();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
