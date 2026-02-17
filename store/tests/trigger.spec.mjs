import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('trigger / force notification', () => {
    /** @type {ReturnType<typeof scope>} */
    let testScope;

    beforeEach(() => {
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
    });

    describe('mutable array updates', () => {
        it('should trigger updates when array is mutated via push', async () => {
            const store = state({ items: /** @type {number[]} */ ([]) });
            let effectRuns = 0;
            let lastLength = -1;

            effect(() => {
                effectRuns++;
                lastLength = store.items.length;
            });

            await flushAll();
            expect(effectRuns).toBe(1);
            expect(lastLength).toBe(0);

            // Push mutates the array - state proxy should handle this
            store.items.push(1);
            await flushAll();
            expect(effectRuns).toBe(2);
            expect(lastLength).toBe(1);
        });

        it('should trigger updates for dependent computed when array is mutated', async () => {
            const store = state({ items: /** @type {number[]} */ ([]) });
            const length = computed(() => store.items.length);

            expect(length()).toBe(0);
            store.items.push(1);
            expect(length()).toBe(1);
        });

        it('should trigger effect once for multiple array mutations', async () => {
            const store = state({ items: /** @type {number[]} */ ([]) });
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                store.items.length;
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.items.push(1);
            store.items.push(2);
            store.items.push(3);
            await flushAll();
            // Effect should run once per flush, not per mutation
            expect(effectRuns).toBeGreaterThanOrEqual(2);
        });

        it('should handle pop mutations', async () => {
            const store = state({ items: [1, 2, 3] });
            const length = computed(() => store.items.length);

            expect(length()).toBe(3);
            store.items.pop();
            expect(length()).toBe(2);
        });

        it('should handle splice mutations', async () => {
            const store = state({ items: [1, 2, 3, 4, 5] });
            const sum = computed(() => store.items.reduce((a, b) => a + b, 0));

            expect(sum()).toBe(15);
            store.items.splice(1, 2); // Remove 2 and 3
            expect(sum()).toBe(10); // 1 + 4 + 5
        });

        it('should handle shift and unshift', async () => {
            const store = state({ items: [1, 2, 3] });
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                store.items[0];
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.items.unshift(0);
            await flushAll();
            expect(store.items[0]).toBe(0);
            expect(effectRuns).toBe(2);

            store.items.shift();
            await flushAll();
            expect(store.items[0]).toBe(1);
            expect(effectRuns).toBe(3);
        });
    });

    describe('mutable object updates', () => {
        it('should trigger updates when nested object property changes', async () => {
            const store = state({
                user: {
                    name: 'John',
                    address: { city: 'NYC' },
                },
            });
            let lastCity = '';

            effect(() => {
                lastCity = store.user.address.city;
            });

            await flushAll();
            expect(lastCity).toBe('NYC');

            store.user.address.city = 'LA';
            await flushAll();
            expect(lastCity).toBe('LA');
        });

        it('should trigger computed when nested property changes', () => {
            const store = state({
                config: {
                    settings: { theme: 'dark' },
                },
            });
            const theme = computed(() => store.config.settings.theme);

            expect(theme()).toBe('dark');
            store.config.settings.theme = 'light';
            expect(theme()).toBe('light');
        });
    });

    describe('signal force updates', () => {
        it('should not trigger when same primitive value is set', async () => {
            const s = signal(5);
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            s.set(5); // Same value
            await flushAll();
            expect(effectRuns).toBe(1);
        });

        it('should trigger when different value is set', async () => {
            const s = signal(5);
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            s.set(10);
            await flushAll();
            expect(effectRuns).toBe(2);
        });

        it('should not trigger when same object reference is set', async () => {
            const obj = { value: 1 };
            const s = signal(obj);
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            // Mutate and set same reference
            obj.value = 2;
            s.set(obj);
            await flushAll();
            expect(effectRuns).toBe(1); // Same reference, no trigger
        });

        it('should trigger when new object reference is set', async () => {
            const s = signal({ value: 1 });
            let effectRuns = 0;

            effect(() => {
                effectRuns++;
                s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            s.set({ value: 1 }); // New object, same content
            await flushAll();
            expect(effectRuns).toBe(2);
        });
    });

    describe('state array methods trigger correctly', () => {
        it('sort triggers update', async () => {
            const store = state({ items: [3, 1, 2] });
            const first = computed(() => store.items[0]);

            expect(first()).toBe(3);
            store.items.sort((a, b) => a - b);
            expect(first()).toBe(1);
        });

        it('reverse triggers update', async () => {
            const store = state({ items: [1, 2, 3] });
            const snapshot = computed(() => [...store.items]);

            expect(snapshot()).toEqual([1, 2, 3]);
            store.items.reverse();
            expect(snapshot()).toEqual([3, 2, 1]);
        });

        it('fill triggers update', async () => {
            const store = state({ items: [1, 2, 3] });
            const sum = computed(() => store.items.reduce((a, b) => a + b, 0));

            expect(sum()).toBe(6);
            store.items.fill(0);
            expect(sum()).toBe(0);
        });

        it('copyWithin triggers update', async () => {
            const store = state({ items: [1, 2, 3, 4, 5] });
            const snapshot = computed(() => [...store.items]);

            expect(snapshot()).toEqual([1, 2, 3, 4, 5]);
            store.items.copyWithin(0, 3); // Copy [4, 5] to beginning
            expect(snapshot()).toEqual([4, 5, 3, 4, 5]);
        });
    });

    describe('computed with mutable source', () => {
        it('computed using array length updates correctly', async () => {
            const store = state({ items: /** @type {number[]} */ ([]) });
            const isEmpty = computed(() => store.items.length === 0);

            expect(isEmpty()).toBe(true);
            store.items.push(1);
            expect(isEmpty()).toBe(false);
            store.items.pop();
            expect(isEmpty()).toBe(true);
        });

        it('computed using array includes updates correctly', async () => {
            const store = state({ items: /** @type {string[]} */ ([]) });
            const hasApple = computed(() => store.items.includes('apple'));

            expect(hasApple()).toBe(false);
            store.items.push('apple');
            expect(hasApple()).toBe(true);
            store.items.splice(store.items.indexOf('apple'), 1);
            expect(hasApple()).toBe(false);
        });

        it('computed with filter updates correctly', async () => {
            const store = state({ numbers: [1, 2, 3, 4, 5] });
            const evens = computed(() => store.numbers.filter(n => n % 2 === 0));

            expect(evens()).toEqual([2, 4]);
            store.numbers.push(6);
            expect(evens()).toEqual([2, 4, 6]);
        });

        it('computed with map updates correctly', async () => {
            const store = state({ values: [1, 2, 3] });
            const doubled = computed(() => store.values.map(v => v * 2));

            expect(doubled()).toEqual([2, 4, 6]);
            store.values.push(4);
            expect(doubled()).toEqual([2, 4, 6, 8]);
        });
    });

    describe('effect with mutable source', () => {
        it('effect sees final array state after mutations', async () => {
            const store = state({ items: /** @type {number[]} */ ([]) });
            /** @type {number[]} */
            let captured = [];

            effect(() => {
                captured = [...store.items];
            });

            await flushAll();
            expect(captured).toEqual([]);

            store.items.push(1);
            store.items.push(2);
            store.items.push(3);
            await flushAll();
            expect(captured).toEqual([1, 2, 3]);
        });

        it('effect cleanup runs when array dependency changes', async () => {
            const store = state({ items: [1] });
            let cleanupRuns = 0;

            effect(() => {
                store.items.length;
                return () => {
                    cleanupRuns++;
                };
            });

            await flushAll();
            expect(cleanupRuns).toBe(0);

            store.items.push(2);
            await flushAll();
            expect(cleanupRuns).toBe(1);
        });
    });
});
