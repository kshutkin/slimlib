import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { effect, flushEffects, scope, setActiveScope, state, unwrapValue } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    // First yield to microtask queue to let scheduled effects be queued
    await Promise.resolve();
    // Then flush any pending effects
    flushEffects();
    // Finally wait for any async cleanup
    await flushPromises();
}

describe('store', () => {
    let testScope;

    beforeEach(() => {
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
    });

    it('smoke', () => {
        expect(state).toBeDefined();
    });

    describe('change detection', () => {
        it('string', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 'test' });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = 'test2';
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber).toHaveBeenCalledWith('test2');
            expect(unwrapValue(store).prop).toBe('test2');
            expect(store.prop).toBe('test2');
        });

        it('number', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 3 });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = 42;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(3);
            expect(subscriber).toHaveBeenCalledWith(42);
            expect(unwrapValue(store).prop).toBe(42);
            expect(store.prop).toBe(42);
        });

        it('boolean', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: false });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = true;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(false);
            expect(subscriber).toHaveBeenCalledWith(true);
            expect(unwrapValue(store).prop).toBe(true);
            expect(store.prop).toBe(true);
        });

        it('1 => null', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: /** @type {number | null} */ (1) });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = null;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(null);
            expect(unwrapValue(store).prop).toBe(null);
            expect(store.prop).toBe(null);
        });

        it('1 => undefined', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: /** @type {number | undefined} */ (1) });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = undefined;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(unwrapValue(store).prop).toBe(undefined);
            expect(store.prop).toBe(undefined);
        });

        it('object', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: /** @type {{a?: number, b?: number}} */ ({ a: 1 }) });
            effect(() => subscriber({ ...store.prop }));
            const b = { b: 2 };
            await flushAll();
            store.prop = b;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith({ a: 1 });
            expect(subscriber).toHaveBeenCalledWith({ b: 2 });
            expect(unwrapValue(store).prop).toBe(b);
            expect(store.prop.b).toBe(2);
        });

        it('array', async () => {
            const subscriber = vi.fn();
            const store = state({ items: [1, 2, 3] });
            effect(() => subscriber([...store.items]));
            await flushAll();
            store.items.push(4);
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
            expect(subscriber).toHaveBeenCalledWith([1, 2, 3, 4]);
        });

        it('RegExp', () => {
            const store = state({ prop: /test/ });
            store.prop = /test2/;
            expect(store.prop.test('test2')).toBe(true);
        });

        it('define property on Proxy', async () => {
            const subscriber = vi.fn();
            const store = state(/** @type {{prop?: string}} */ ({}));
            effect(() => subscriber(store.prop));
            await flushAll();
            Object.defineProperty(store, 'prop', {
                value: 'test',
            });
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(store.prop).toBe('test');
        });

        it('define writable property on Proxy', async () => {
            const subscriber = vi.fn();
            const store = state(/** @type {{prop?: string}} */ ({}));
            effect(() => subscriber(store.prop));
            await flushAll();
            Object.defineProperty(store, 'prop', {
                value: 'test',
                writable: true,
            });
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(undefined);
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(unwrapValue(store).prop).toBe('test');
        });

        it('define non configurable property on initial state', () => {
            const initialState = {};
            Object.defineProperty(initialState, 'prop', {
                configurable: false,
                value: 'test',
            });
            const store = state(initialState);
            expect(store.prop).toBe('test');
        });

        it('allows iteration over array', () => {
            const items = [1, 2, 3];
            const store = state({ items });
            let summ = 0;
            for (const item of store.items) {
                summ += item;
            }
            expect(summ).toBe(6);
        });

        it('no changes', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 'test' });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = 'test';
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('triggers once per action', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 'test' });
            effect(() => subscriber(store.prop));
            await flushAll();
            store.prop = 'test2';
            store.prop = 'test3';
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2); // initial + one batched update
        });

        it('nested object', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: { a: 1 } });
            effect(() => subscriber(store.prop.a));
            await flushAll();
            store.prop.a = 2;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
            expect(unwrapValue(store).prop.a).toBe(2);
            expect(store.prop.a).toBe(2);
        });

        it('handles delete property', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: /** @type {string | undefined} */ ('test') });
            effect(() => subscriber(store.prop));
            await flushAll();
            delete store.prop;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber).toHaveBeenCalledWith(undefined);
        });

        it('reuse object', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: /** @type {{a: number}} */ ({ a: 1 }) });
            effect(() => subscriber({ ...store.prop }));
            await flushAll();
            // Intentional self-assignment to test proxy behavior
            const temp = store.prop;
            store.prop = temp;
            store.prop.a = 2;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith({ a: 1 });
            expect(subscriber).toHaveBeenCalledWith({ a: 2 });
        });

        it('change object in array', async () => {
            const subscriber = vi.fn();
            const store = state({ data: /** @type {Array<{prop: number}>} */ ([{ prop: 1 }]) });
            effect(() => subscriber(store.data[0]?.prop));
            await flushAll();
            // @ts-expect-error - we know data[0] exists
            store.data[0].prop = 2;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(1);
            expect(subscriber).toHaveBeenCalledWith(2);
            // @ts-expect-error - we know data[0] exists
            expect(unwrapValue(store).data[0].prop).toBe(2);
        });

        it('find index in array (only wrappers)', () => {
            const store = state({ data: [{ prop: 1 }] });
            const index = store.data.findIndex(item => unwrapValue(item).prop === 1);
            expect(index).toBe(0);
        });

        it('Map in store', () => {
            const store = state({ map: new Map() });
            expect(store.map).toBeDefined();
        });

        it('Map in store (set value)', async () => {
            const subscriber = vi.fn();
            const value = { a: 1 };
            const store = state({ map: new Map() });
            effect(() => subscriber(store.map.size));
            await flushAll();
            store.map.set('key', value);
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(0);
            expect(subscriber).toHaveBeenCalledWith(1);
        });

        it('Map in store (get value)', async () => {
            const subscriber = vi.fn();
            const value = { a: 1 };
            const store = state({ map: new Map([['key', value]]) });
            effect(() => subscriber(store.map.size));
            const size = store.map.size;
            expect(size).toBe(1);
            expect(store.map.get('key')).toBe(value);
        });

        it('second level proxy triggers subscriber', async () => {
            const subscriber = vi.fn();
            const value = { prop: { value: { value2: 'test' } } };
            const store = state(value);
            const prop = store.prop;
            effect(() => subscriber(prop.value.value2));
            await flushAll();
            store.prop.value.value2 = 'test2';
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber).toHaveBeenCalledWith('test2');
        });

        it('find index in array (mixed objects)', () => {
            const store = state({ data: [{ prop: 1 }] });
            const index = store.data.findIndex(item => item.prop === 1);
            expect(index).toBe(0);
        });

        it('swap in array', async () => {
            const subscriber = vi.fn();
            const store = state({ data: /** @type {Array<{prop: number}>} */ ([{ prop: 1 }, { prop: 2 }]) });
            effect(() => subscriber([store.data[0]?.prop, store.data[1]?.prop]));
            await flushPromises();
            const temp = /** @type {{prop: number}} */ (store.data[0]);
            store.data[0] = /** @type {{prop: number}} */ (store.data[1]);
            store.data[1] = temp;
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith([1, 2]);
            expect(subscriber).toHaveBeenCalledWith([2, 1]);
            expect(store.data[0]?.prop).toBe(2);
            expect(store.data[1]?.prop).toBe(1);
        });

        it('Object.assign (proxy as a target, no new properties)', async () => {
            const subscriber = vi.fn();
            const store = state({ test: 1 });
            effect(() => subscriber({ test: store.test }));
            await flushPromises();
            Object.assign(store, { test: 2 });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({ test: 1 });
            expect(subscriber).toHaveBeenCalledWith({ test: 2 });
        });

        describe('array methods', () => {
            describe('mutating methods', () => {
                it('pop', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [1, 2, 3] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const popped = store.items.pop();
                    await flushPromises();
                    expect(popped).toBe(3);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([1, 2]);
                });

                it('shift', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [1, 2, 3] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const shifted = store.items.shift();
                    await flushPromises();
                    expect(shifted).toBe(1);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([2, 3]);
                });

                it('unshift', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [1, 2, 3] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const newLength = store.items.unshift(0);
                    await flushPromises();
                    expect(newLength).toBe(4);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([0, 1, 2, 3]);
                });

                it('splice', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [1, 2, 3] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const removed = store.items.splice(1, 1, 10);
                    await flushPromises();
                    expect(removed).toEqual([2]);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([1, 10, 3]);
                });

                it('sort', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [3, 1, 2] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const sorted = store.items.sort();
                    await flushPromises();
                    expect(sorted).toEqual([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([3, 1, 2]);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                });

                it('reverse', async () => {
                    const subscriber = vi.fn();
                    const store = state({ items: [1, 2, 3] });
                    effect(() => subscriber([...store.items]));
                    await flushPromises();
                    const reversed = store.items.reverse();
                    await flushPromises();
                    expect(reversed).toEqual([3, 2, 1]);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                    expect(subscriber).toHaveBeenCalledWith([3, 2, 1]);
                });
            });

            describe('non-mutating methods', () => {
                it('map', () => {
                    const store = state({ items: [1, 2, 3] });
                    const mapped = store.items.map(x => x * 2);
                    expect(mapped).toEqual([2, 4, 6]);
                });

                it('filter', () => {
                    const store = state({ items: [1, 2, 3, 4, 5] });
                    const filtered = store.items.filter(x => x > 2);
                    expect(filtered).toEqual([3, 4, 5]);
                });

                it('slice', () => {
                    const store = state({ items: [1, 2, 3, 4, 5] });
                    const sliced = store.items.slice(1, 4);
                    expect(sliced).toEqual([2, 3, 4]);
                });

                it('concat', () => {
                    const store = state({ items: [1, 2, 3] });
                    const concatenated = store.items.concat([4, 5]);
                    expect(concatenated).toEqual([1, 2, 3, 4, 5]);
                });

                it('find', () => {
                    const store = state({ items: [1, 2, 3, 4, 5] });
                    const found = store.items.find(x => x > 3);
                    expect(found).toBe(4);
                });

                it('findIndex', () => {
                    const store = state({ items: [1, 2, 3, 4, 5] });
                    const index = store.items.findIndex(x => x > 3);
                    expect(index).toBe(3);
                });

                it('some', () => {
                    const store = state({ items: [1, 2, 3, 4, 5] });
                    const hasEven = store.items.some(x => x % 2 === 0);
                    expect(hasEven).toBe(true);
                });

                it('every', () => {
                    const store = state({ items: [2, 4, 6] });
                    const allEven = store.items.every(x => x % 2 === 0);
                    expect(allEven).toBe(true);
                });

                it('forEach', () => {
                    const store = state({ items: [1, 2, 3] });
                    /** @type {number[]} */
                    const results = [];
                    store.items.forEach(x => {
                        results.push(x * 2);
                    });
                    expect(results).toEqual([2, 4, 6]);
                });

                it('includes', () => {
                    const store = state({ items: [1, 2, 3] });
                    expect(store.items.includes(2)).toBe(true);
                    expect(store.items.includes(5)).toBe(false);
                });

                it('indexOf', () => {
                    const store = state({ items: [1, 2, 3, 2] });
                    expect(store.items.indexOf(2)).toBe(1);
                    expect(store.items.indexOf(5)).toBe(-1);
                });

                it('lastIndexOf', () => {
                    const store = state({ items: [1, 2, 3, 2] });
                    expect(store.items.lastIndexOf(2)).toBe(3);
                });

                it('join', () => {
                    const store = state({ items: [1, 2, 3] });
                    const joined = store.items.join('-');
                    expect(joined).toBe('1-2-3');
                });

                it('reduce', () => {
                    const store = state({ items: [1, 2, 3, 4] });
                    const sum = store.items.reduce((acc, x) => acc + x, 0);
                    expect(sum).toBe(10);
                });

                it('reduceRight', () => {
                    const store = state({ items: [1, 2, 3] });
                    const reversed = store.items.reduceRight((acc, x) => acc + x.toString(), '');
                    expect(reversed).toBe('321');
                });
            });

            describe('methods with proxied objects', () => {
                it('map returning objects should be proxied', () => {
                    const store = state({ items: [1, 2, 3] });
                    const mapped = store.items.map(x => ({ value: x }));
                    // The returned objects should work normally
                    expect(mapped[0]?.value).toBe(1);
                    expect(mapped[1]?.value).toBe(2);
                });

                it('filter with object comparisons', () => {
                    const store = state({
                        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
                    });
                    const filtered = store.items.filter(item => item.id > 1);
                    expect(filtered.length).toBe(2);
                    expect(filtered[0]?.id).toBe(2);
                    expect(filtered[1]?.id).toBe(3);
                });

                it('find with nested objects', () => {
                    const store = state({
                        items: [
                            { id: 1, nested: { value: 'a' } },
                            { id: 2, nested: { value: 'b' } },
                        ],
                    });
                    const found = store.items.find(item => item.nested.value === 'b');
                    expect(found?.id).toBe(2);
                });

                it('sort with objects', async () => {
                    const subscriber = vi.fn();
                    const store = state({
                        items: [{ id: 3 }, { id: 1 }, { id: 2 }],
                    });
                    effect(() => subscriber(store.items.map(x => x.id)));
                    await flushPromises();
                    store.items.sort((a, b) => a.id - b.id);
                    await flushPromises();
                    expect(subscriber).toHaveBeenCalledWith([3, 1, 2]);
                    expect(subscriber).toHaveBeenCalledWith([1, 2, 3]);
                });
            });
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
                    const store = state({ func: arrowFunc, value: 10 });
                    effect(() => subscriber(store.value));
                    const result = store.func(1, 2);
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
                    const store = state({ func: arrowFunc, value: 10 });
                    const extracted = store.func;
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
                    const store = state({ func: arrowFunc, value: 10 });
                    const newThis = { custom: true };
                    const result = store.func.call(newThis, 7, 8);
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
                    const store = state(obj);
                    const result = store.func(3, 4);
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
                    const store = state(obj);
                    const extracted = store.func;
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
                    const store = state(obj);
                    const newThis = { custom: true };
                    const result = store.func.call(newThis, 7, 8);
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
                    const store = state(obj);
                    const result = store.func(1, 2);
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
                    const store = state(obj);
                    const extracted = store.func;
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
                    const store = state(obj);
                    const newThis = { custom: true };
                    const result = store.func.call(newThis, 5, 6);
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
                    const store = state(obj);
                    const result = store.func(3, 4);
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
                    const store = state(obj);
                    const extracted = store.func;
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
                    const store = state(obj);
                    const newThis = { custom: true };
                    const result = store.func.call(newThis, 7, 8);
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
                    const store = state(obj);
                    const result = store.method(1, 2);
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
                    const store = state(obj);
                    const extracted = store.method;
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
                    const store = state(obj);
                    const newThis = { custom: true };
                    const result = store.method.call(newThis, 5, 6);
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
                    const store = state(obj);
                    const result = store.getValue();
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
                    const store = state(obj);
                    const result = store.method(1, 2);
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
                    const store = state(obj);
                    const extracted = store.method;
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
                    const store = state(obj);
                    const newThis = { custom: true };
                    const result = store.method.call(newThis, 5, 6);
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
                    const store = state(obj);
                    const result = store.getValue();
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
                    const store = state(obj);
                    const result = store.func(1, 2, 3, 4, 5);
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
                    const store = state(obj);
                    const result = store.func('a', 'b', 'c');
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
                    const store = state(obj);
                    store.func(store.nested);
                    // The argument should be unwrapped to the original object
                    expect(receivedArg).toBe(innerObj);
                });
            });

            describe('function proxying triggers notification', () => {
                it('calling function through proxy triggers notification', async () => {
                    const subscriber = vi.fn();
                    const classicFunc = () => {};
                    const obj = { func: classicFunc, value: 10 };
                    const store = state(obj);
                    effect(() => subscriber(store.value));
                    await flushPromises();
                    store.func();
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
                    const store = state(obj);
                    effect(() => subscriber(store.value));
                    await flushPromises();
                    store.func();
                    await flushPromises();
                    expect(subscriber).toHaveBeenCalledTimes(2);
                });
            });
        });

        it('Object.assign (proxy as a target)', async () => {
            const subscriber = vi.fn();
            const store = state({ data: 1, test: 2 });
            effect(() => subscriber({ data: store.data, test: store.test }));
            await flushPromises();
            Object.assign(store, { test: 3 });
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith({ data: 1, test: 2 });
            expect(subscriber).toHaveBeenCalledWith({ data: 1, test: 3 });
            expect(store.data).toBe(1);
            expect(store.test).toBe(3);
        });

        it('Object.assign (proxy as a source)', () => {
            const store = state({ data: 1 });
            const target = /** @type {{ data?: number }} */ ({});
            Object.assign(target, store);
            expect(target.data).toBe(1);
        });
    });

    describe('effect subscribe/dispose pattern', () => {
        it('one subscriber', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 'test' });
            effect(() => subscriber(store.prop));
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
        });

        it('dispose', async () => {
            const subscriber = vi.fn();
            const store = state({ prop: 'test' });
            const dispose = effect(() => subscriber(store.prop));
            await flushPromises();
            dispose();
            store.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('multiple subscribers', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const store = state({ prop: 'test' });
            effect(() => subscriber(store.prop));
            effect(() => subscriber2(store.prop));
            await flushPromises();
            expect(subscriber).toHaveBeenCalledWith('test');
            expect(subscriber2).toHaveBeenCalledWith('test');
        });

        it('multiple subscribers (dispose one)', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const store = state({ prop: 'test' });
            const dispose = effect(() => subscriber(store.prop));
            effect(() => subscriber2(store.prop));
            await flushPromises();
            dispose();
            store.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(2);
        });

        it('multiple subscribers (dispose all)', async () => {
            const subscriber = vi.fn();
            const subscriber2 = vi.fn();
            const store = state({ prop: 'test' });
            const dispose = effect(() => subscriber(store.prop));
            const dispose2 = effect(() => subscriber2(store.prop));
            await flushPromises();
            dispose();
            dispose2();
            store.prop = 'test2';
            await flushPromises();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(1);
        });
    });
});

describe('unwrapValue', () => {
    it('able to unwrap value', async () => {
        const store = state({ data: 1 });
        const emptyObject = {};
        expect(unwrapValue(store)).toEqual({ data: 1 });
        expect(unwrapValue(emptyObject)).toBe(emptyObject);
        expect(unwrapValue(null)).toBe(null);
        expect(unwrapValue(undefined)).toBe(undefined);
    });
});

describe('defineProperty edge cases', () => {
    it('defineProperty returns false for non-configurable property redefinition', async () => {
        const initialState = {};
        Object.defineProperty(initialState, 'locked', {
            configurable: false,
            writable: false,
            value: 'original',
        });
        const store = state(initialState);

        // Trying to redefine a non-configurable property should fail
        // Use Reflect.defineProperty to get boolean result instead of throw
        const result = Reflect.defineProperty(store, 'locked', {
            value: 'new',
        });
        expect(result).toBe(false);
        // The property should still have original value
        expect(store.locked).toBe('original');
    });

    it('deleteProperty returns false for non-configurable property', async () => {
        const subscriber = vi.fn();
        const initialState = /** @type {{locked?: string, other?: string}} */ ({});
        Object.defineProperty(initialState, 'locked', {
            configurable: false,
            writable: false,
            value: 'cannot delete',
        });
        initialState.other = 'can delete';

        const store = state(initialState);
        effect(() => subscriber(store.other));
        await flushPromises();

        // Trying to delete a non-configurable property should fail
        const deleteResult = Reflect.deleteProperty(store, 'locked');
        expect(deleteResult).toBe(false);
        expect(store.locked).toBe('cannot delete');

        // Deleting configurable property should work
        delete store.other;
        await flushPromises();
        expect(store.other).toBe(undefined);
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('deleteProperty on non-existent property', async () => {
        const store = state(/** @type {{prop?: string}} */ ({}));

        // Deleting non-existent property returns true but no notification needed
        const result = delete store.prop;
        expect(result).toBe(true);
    });
});
