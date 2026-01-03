import { describe, expect, it, vi } from 'vitest';

import { createStore, effect, unwrapValue } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('store', () => {
    it('smoke', () => {
        expect(createStore).toBeDefined();
    });

    describe('change detection', () => {
        it('string', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 'test' });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber).toHaveBeenCalledWith('test2');
            expect(unwrapValue(state).prop).toBe('test2');
            expect(state.prop).toBe('test2');
        });

        it('number', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 3 });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = 42;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(3);
            expect(subscriber).toHaveBeenCalledWith(42);
            expect(unwrapValue(state).prop).toBe(42);
            expect(state.prop).toBe(42);
        });

        it('boolean', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: false });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = true;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(false);
            expect(subscriber).toHaveBeenCalledWith(true);
            expect(unwrapValue(state).prop).toBe(true);
            expect(state.prop).toBe(true);
        });

        it('1 => null', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: /** @type {number | null} */ (1) });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = null;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(null);
            expect(unwrapValue(state).prop).toBe(null);
            expect(state.prop).toBe(null);
        });

        it('1 => undefined', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: /** @type {number | undefined} */ (1) });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = undefined;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(unwrapValue(state).prop).toBe(undefined);
            expect(state.prop).toBe(undefined);
        });

        it('object', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: /** @type {{a?: number, b?: number}} */ ({ a: 1 }) });
            effect(() => subscriber({ ...state.prop }));
            const b = { b: 2 };
            await flushPromises();
            state.prop = b;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({ a: 1 });
            expect(subscriber).toHaveBeenCalledWith({ b: 2 });
            expect(unwrapValue(state).prop).toBe(b);
            expect(state.prop.b).toBe(2);
        });

        it('array', async () => {
            const subscriber = vi.fn();
            const state = createStore({ items: [1, 2, 3] });
            effect(() => subscriber([...state.items]));
            await flushPromises();
            state.items.push(4);
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
            expect(subscriber).toHaveBeenCalledWith([1, 2, 3, 4]);
        });

        it('RegExp', () => {
            const state = createStore({ prop: /test/ });
            state.prop = /test2/;
            expect(state.prop.test('test2')).toBe(true);
        });

        it('define writable property on Proxy', async () => {
            const subscriber = vi.fn();
            const state = createStore(/** @type {{prop?: string}} */ ({}));
            effect(() => subscriber(state.prop));
            await flushPromises();
            Object.defineProperty(state, 'prop', {
                value: 'test',
                writable: true,
            });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(unwrapValue(state).prop).toBe('test');
        });

        it('define property on Proxy', async () => {
            const subscriber = vi.fn();
            const state = createStore(/** @type {{prop?: string}} */ ({}));
            effect(() => subscriber(state.prop));
            await flushPromises();
            Object.defineProperty(state, 'prop', {
                value: 'test',
            });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(unwrapValue(state).prop).toBe('test');
        });

        it('define non configurable property on initial state', () => {
            const initialState = {};
            Object.defineProperty(initialState, 'prop', {
                configurable: false,
                value: 'test',
            });
            const state = createStore(initialState);
            expect(state.prop).toBe('test');
        });

        it('allows iteration over array', () => {
            const items = [1, 2, 3];
            const state = createStore({ items });
            let summ = 0;
            for (const item of state.items) {
                summ += item;
            }
            expect(summ).toBe(6);
        });

        it('no changes', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 'test' });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = 'test';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('triggers once per action', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 'test' });
            effect(() => subscriber(state.prop));
            await flushPromises();
            state.prop = 'test2';
            state.prop = 'test3';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(2); // initial + one batched update
        });

        it('nested object', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: { a: 1 } });
            effect(() => subscriber(state.prop.a));
            await flushPromises();
            state.prop.a = 2;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
            expect(unwrapValue(state).prop.a).toBe(2);
            expect(state.prop.a).toBe(2);
        });

        it('handles delete property', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: /** @type {string | undefined} */ ('test') });
            effect(() => subscriber(state.prop));
            await flushPromises();
            delete state.prop;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber).toHaveBeenCalledWith(undefined);
        });

        it('reuse object', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: /** @type {{a: number}} */ ({ a: 1 }) });
            effect(() => subscriber({ ...state.prop }));
            await flushPromises();
            // Intentional self-assignment to test proxy behavior
            const temp = state.prop;
            state.prop = temp;
            state.prop.a = 2;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({ a: 1 });
            expect(subscriber).toHaveBeenCalledWith({ a: 2 });
        });

        it('change object in array', async () => {
            const subscriber = vi.fn();
            const state = createStore({ data: /** @type {Array<{prop: number}>} */ ([{ prop: 1 }]) });
            effect(() => subscriber(state.data[0]?.prop));
            await flushPromises();
            // @ts-expect-error - we know data[0] exists
            state.data[0].prop = 2;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
            // @ts-expect-error - we know data[0] exists
            expect(state.data[0].prop).toBe(2);
        });

        it('find index in array (only wrappers)', () => {
            const state = createStore({ data: [{ prop: 1 }] });
            const index = state.data.findIndex(item => unwrapValue(item).prop === 1);
            expect(index).toBe(0);
        });

        it('Map in store', () => {
            const state = createStore({ map: new Map() });
            expect(state.map).toBeDefined();
        });

        it('Map in store (set value)', async () => {
            const subscriber = vi.fn();
            const value = { a: 1 };
            const state = createStore({ map: new Map() });
            effect(() => subscriber(state.map.size));
            await flushPromises();
            state.map.set('key', value);
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(0);
            expect(subscriber).toHaveBeenCalledWith(1);
        });

        it('Map in store (get value)', async () => {
            const subscriber = vi.fn();
            const value = { a: 1 };
            const state = createStore({ map: new Map([['key', value]]) });
            effect(() => subscriber(state.map.size));
            const size = state.map.size;
            expect(size).toBe(1);
            expect(state.map.get('key')).toBe(value);
        });

        it('second level proxy triggers subscriber', async () => {
            const subscriber = vi.fn();
            const value = { prop: { value: { value2: 1 } } };
            const state = createStore(value);
            const prop = state.prop;
            effect(() => subscriber(prop.value.value2));
            await flushPromises();
            prop.value.value2 = 2;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
        });

        it('find index in array (mixed objects)', () => {
            const state = createStore({ data: [{ prop: 1 }] });
            const index = state.data.findIndex(item => item.prop === 1);
            expect(index).toBe(0);
        });

        it('swap in array', async () => {
            const subscriber = vi.fn();
            const state = createStore({ data: /** @type {Array<{prop: number}>} */ ([{ prop: 1 }, { prop: 2 }]) });
            effect(() => subscriber([state.data[0]?.prop, state.data[1]?.prop]));
            await flushPromises();
            const temp = /** @type {{prop: number}} */ (state.data[0]);
            state.data[0] = /** @type {{prop: number}} */ (state.data[1]);
            state.data[1] = temp;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith([1, 2]);
            expect(subscriber).toHaveBeenCalledWith([2, 1]);
            expect(state.data[0]?.prop).toBe(2);
            expect(state.data[1]?.prop).toBe(1);
        });

        it('Object.assign (proxy as a target, no new properties)', async () => {
            const subscriber = vi.fn();
            const state = createStore({ test: 1 });
            effect(() => subscriber(state.test));
            await flushPromises();
            Object.assign(state, { test: 2 });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
            expect(state.test).toBe(2);
        });

        describe('function proxying through proxy', () => {
            // Note: Functions are proxied to trigger notifications
            // When accessing a function property, it's wrapped to call the original
            // with the proper `this` context (the target, not the proxy)

            describe('own property + arrow function', () => {
                // Arrow functions don't have their own `this`, they use lexical `this`
                // When proxied and called, `this` inside the arrow function is still
                // whatever it was at definition time (typically undefined or outer scope)

                it('normal call (object.func notation)', async () => {
                    const subscriber = vi.fn();
                    let receivedArgs;
                    // Arrow function doesn't bind this, so `this` will be undefined/outer
                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return a + b;
                    };
                    const state = createStore({ func: arrowFunc, value: 10 });
                    effect(() => subscriber(state.value));
                    const result = state.func(1, 2);
                    expect(result).toBe(3);
                    expect(receivedArgs).toEqual([1, 2]);
                });

                it('no this (extracted call)', async () => {
                    // Even when extracted, arrow function still uses lexical `this`
                    let receivedArgs;

                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return 'arrow-result';
                    };
                    const state = createStore({ func: arrowFunc, value: 10 });
                    const extracted = state.func;
                    const result = extracted(5, 6);
                    expect(result).toBe('arrow-result');
                    expect(receivedArgs).toEqual([5, 6]);
                });

                it('new this (.call/.apply)', async () => {
                    // .call/.apply has no effect on arrow functions - they keep lexical `this`
                    let receivedArgs;

                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return 'arrow-call';
                    };
                    const state = createStore({ func: arrowFunc, value: 10 });
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 7, 8);
                    expect(result).toBe('arrow-call');
                    expect(receivedArgs).toEqual([7, 8]);
                });
            });

            describe('own property + classic function', () => {
                it('normal call (object.func notation)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    // Classic function - `this` is bound based on call site
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return a * b;
                    };
                    const obj = { func: classicFunc, value: 10 };
                    const state = createStore(obj);
                    const result = state.func(3, 4);
                    expect(result).toBe(12);
                    expect(receivedArgs).toEqual([3, 4]);
                    // When called through proxy, `this` should be the original target
                    expect(capturedThis).toBe(obj);
                });

                it('no this (extracted call)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    // When extracted and called, `this` depends on call context
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'classic-extracted';
                    };
                    const obj = { func: classicFunc, value: 10 };
                    const state = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(5, 6);
                    expect(result).toBe('classic-extracted');
                    expect(receivedArgs).toEqual([5, 6]);
                    // When called as standalone, the wrapper applies `this` to original target
                    expect(capturedThis).toBe(obj);
                });

                it('new this (.call/.apply)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    // When using .call or .apply, `this` is explicitly set
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'classic-call';
                    };
                    const obj = { func: classicFunc, value: 10 };
                    const state = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 7, 8);
                    expect(result).toBe('classic-call');
                    expect(receivedArgs).toEqual([7, 8]);
                    // Our implementation binds to original target, ignoring .call's this
                    expect(capturedThis).toBe(obj);
                });
            });

            describe('prototype + arrow function', () => {
                // Arrow functions on prototype are unusual but valid
                // They still don't bind `this`

                it('normal call (object.func notation)', async () => {
                    let receivedArgs;

                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto);
                    const state = createStore(obj);
                    const result = state.func(1, 2);
                    expect(result).toBe('proto-arrow');
                    expect(receivedArgs).toEqual([1, 2]);
                });

                it('no this (extracted call)', async () => {
                    let receivedArgs;

                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow-extracted';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto);
                    const state = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(3, 4);
                    expect(result).toBe('proto-arrow-extracted');
                    expect(receivedArgs).toEqual([3, 4]);
                });

                it('new this (.call/.apply)', async () => {
                    let receivedArgs;

                    const arrowFunc = (/** @type {number} */ a, /** @type {number} */ b) => {
                        receivedArgs = [a, b];
                        return 'proto-arrow-call';
                    };
                    const proto = { func: arrowFunc };
                    const obj = Object.create(proto);
                    const state = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 5, 6);
                    expect(result).toBe('proto-arrow-call');
                    expect(receivedArgs).toEqual([5, 6]);
                });
            });

            describe('prototype + classic function', () => {
                it('normal call (object.func notation)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto);
                    obj.value = 10;
                    const state = createStore(obj);
                    const result = state.func(3, 4);
                    expect(result).toBe('proto-classic');
                    expect(receivedArgs).toEqual([3, 4]);
                    expect(capturedThis).toBe(obj);
                });

                it('no this (extracted call)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic-extracted';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto);
                    obj.value = 10;
                    const state = createStore(obj);
                    const extracted = state.func;
                    const result = extracted(5, 6);
                    expect(result).toBe('proto-classic-extracted');
                    expect(receivedArgs).toEqual([5, 6]);
                    expect(capturedThis).toBe(obj);
                });

                it('new this (.call/.apply)', async () => {
                    let capturedThis;
                    let receivedArgs;
                    const classicFunc = /** @this {any} */ function (/** @type {number} */ a, /** @type {number} */ b) {
                        capturedThis = this;
                        receivedArgs = [a, b];
                        return 'proto-classic-call';
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto);
                    obj.value = 10;
                    const state = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.func.call(newThis, 7, 8);
                    expect(result).toBe('proto-classic-call');
                    expect(receivedArgs).toEqual([7, 8]);
                    expect(capturedThis).toBe(obj);
                });
            });

            describe('class with classic methods', () => {
                it('normal call (object.method notation)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method(/** @type {number} */ a, /** @type {number} */ b) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return a + b + this.value;
                        }
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const result = state.method(1, 2);
                    expect(result).toBe(13); // 1 + 2 + 10
                    expect(receivedArgs).toEqual([1, 2]);
                    expect(capturedThis).toBe(obj);
                });

                it('no this (extracted call)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method(/** @type {number} */ a, /** @type {number} */ b) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return a + b + this.value;
                        }
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const extracted = state.method;
                    const result = extracted(3, 4);
                    expect(result).toBe(17); // 3 + 4 + 10
                    expect(receivedArgs).toEqual([3, 4]);
                    expect(capturedThis).toBe(obj);
                });

                it('new this (.call/.apply)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method(/** @type {number} */ a, /** @type {number} */ b) {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'class-method-call';
                        }
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.method.call(newThis, 5, 6);
                    expect(result).toBe('class-method-call');
                    expect(receivedArgs).toEqual([5, 6]);
                    expect(capturedThis).toBe(obj);
                });

                it('method can access instance properties via this', () => {
                    class MyClass {
                        value = 42;

                        getValue() {
                            return this.value;
                        }
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const result = state.getValue();
                    expect(result).toBe(42);
                });
            });

            describe('class with member arrow functions', () => {
                // Arrow function class members are instance properties
                // They capture `this` at construction time

                it('normal call (object.method notation)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method = (/** @type {number} */ a, /** @type {number} */ b) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return a + b + this.value;
                        };
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const result = state.method(1, 2);
                    expect(result).toBe(13);
                    expect(receivedArgs).toEqual([1, 2]);
                    // Arrow functions keep their lexical `this` (the instance)
                    expect(capturedThis).toBe(obj);
                });

                it('no this (extracted call)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method = (/** @type {number} */ a, /** @type {number} */ b) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return a + b + this.value;
                        };
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const extracted = state.method;
                    const result = extracted(3, 4);
                    expect(result).toBe(17);
                    expect(receivedArgs).toEqual([3, 4]);
                    expect(capturedThis).toBe(obj);
                });

                it('new this (.call/.apply)', async () => {
                    let capturedThis;
                    let receivedArgs;

                    class MyClass {
                        value = 10;

                        method = (/** @type {number} */ a, /** @type {number} */ b) => {
                            capturedThis = this;
                            receivedArgs = [a, b];
                            return 'arrow-member-call';
                        };
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const newThis = { custom: true };
                    const result = state.method.call(newThis, 5, 6);
                    expect(result).toBe('arrow-member-call');
                    expect(receivedArgs).toEqual([5, 6]);
                    expect(capturedThis).toBe(obj);
                });

                it('arrow method can access instance properties via this', () => {
                    class MyClass {
                        value = 42;

                        getValue = () => {
                            return this.value;
                        };
                    }
                    const obj = new MyClass();
                    const state = createStore(obj);
                    const result = state.getValue();
                    expect(result).toBe(42);
                });
            });

            describe('function proxying with arguments', () => {
                it('passes arguments correctly for own property classic function', async () => {
                    let receivedArgs;

                    const classicFunc = (/** @type {any} */ ...args) => {
                        receivedArgs = args;
                        return args.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
                    };
                    const obj = { func: classicFunc };
                    const state = createStore(obj);
                    const result = state.func(1, 2, 3, 4, 5);
                    expect(result).toBe(15);
                    expect(receivedArgs).toEqual([1, 2, 3, 4, 5]);
                });

                it('passes arguments correctly for prototype classic function', async () => {
                    let receivedArgs;

                    const classicFunc = (/** @type {any} */ ...args) => {
                        receivedArgs = args;
                        return args.join('-');
                    };
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto);
                    const state = createStore(obj);
                    const result = state.func('a', 'b', 'c');
                    expect(result).toBe('a-b-c');
                    expect(receivedArgs).toEqual(['a', 'b', 'c']);
                });

                it('unwraps proxy arguments when calling function', async () => {
                    let receivedArg;

                    const classicFunc = (/** @type {any} */ arg) => {
                        receivedArg = arg;
                    };
                    const innerObj = { inner: true };
                    const obj = { func: classicFunc, nested: innerObj };
                    const state = createStore(obj);
                    state.func(state.nested);
                    // The argument should be unwrapped to the original object
                    expect(receivedArg).toBe(innerObj);
                });
            });

            describe('function proxying triggers notification', () => {
                it('calling function through proxy triggers notification', async () => {
                    const subscriber = vi.fn();
                    const classicFunc = () => {};
                    const obj = { func: classicFunc, value: 10 };
                    const state = createStore(obj);
                    effect(() => subscriber(state.value));
                    await flushPromises();
                    state.func();
                    await flushPromises();
                    // Function calls trigger notification to handle mutations
                    expect(subscriber).toHaveBeenCalledTimes(2);
                });

                it('calling prototype function through proxy triggers notification', async () => {
                    const subscriber = vi.fn();
                    const classicFunc = () => {};
                    const proto = { func: classicFunc };
                    const obj = Object.create(proto);
                    obj.value = 10;
                    const state = createStore(obj);
                    effect(() => subscriber(state.value));
                    await flushPromises();
                    state.func();
                    await flushPromises();
                    expect(subscriber).toHaveBeenCalledTimes(2);
                });
            });
        });

        it('Object.assign (proxy as a target)', async () => {
            const subscriber = vi.fn();
            const state = createStore({ data: 1, test: 2 });
            effect(() => subscriber({ data: state.data, test: state.test }));
            await flushPromises();
            Object.assign(state, { test: 3 });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({ data: 1, test: 2 });
            expect(subscriber).toHaveBeenCalledWith({ data: 1, test: 3 });
            expect(state.data).toBe(1);
            expect(state.test).toBe(3);
        });

        it('Object.assign (proxy as a source)', () => {
            const state = createStore({ data: 1 });
            const target = /** @type {{ data?: number }} */ ({});
            Object.assign(target, state);
            expect(target.data).toBe(1);
        });
    });

    describe('effect subscribe/dispose pattern', () => {
        it('one subscriber', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 'test' });
            effect(() => subscriber(state.prop));
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
        });

        it('dispose', async () => {
            const subscriber = vi.fn();
            const state = createStore({ prop: 'test' });
            const dispose = effect(() => subscriber(state.prop));
            await flushPromises();
            dispose();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('multiple subscribers', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const state = createStore({ prop: 'test' });
            effect(() => subscriber(state.prop));
            effect(() => subscriber2(state.prop));
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber2).toHaveBeenCalledWith('test');
        });

        it('multiple subscribers (dispose one)', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const state = createStore({ prop: 'test' });
            const dispose = effect(() => subscriber(state.prop));
            effect(() => subscriber2(state.prop));
            await flushPromises();
            dispose();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(2);
        });

        it('multiple subscribers (dispose all)', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const state = createStore({ prop: 'test' });
            const dispose = effect(() => subscriber(state.prop));
            const dispose2 = effect(() => subscriber2(state.prop));
            await flushPromises();
            dispose();
            dispose2();
            state.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(1);
        });
    });
});

describe('unwrapValue', () => {
    it('able to unwrap value', async () => {
        const state = createStore({ data: 1 });
        const emptyObject = {};
        expect(unwrapValue(state)).toEqual({ data: 1 });
        expect(unwrapValue(emptyObject)).toBe(emptyObject);
        expect(unwrapValue(null)).toBe(null);
        expect(unwrapValue(undefined)).toBe(undefined);
    });
});
