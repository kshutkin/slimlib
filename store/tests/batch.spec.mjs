import { describe, expect, it } from 'vitest';

import { computed, createStore, effect } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('automatic batching', () => {
    it('multiple synchronous updates result in single effect run', async () => {
        const store = createStore({ count: 0 });
        let runs = 0;

        effect(() => {
            store.count;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1); // Initial run

        // Multiple synchronous updates
        store.count = 1;
        store.count = 2;
        store.count = 3;

        await flushPromises();
        expect(runs).toBe(2); // Only one additional run
        expect(store.count).toBe(3); // Final value is correct
    });

    it('effect sees final values after batch', async () => {
        const store = createStore({ a: 0, b: 0, c: 0 });
        let result = {};

        effect(() => {
            result = { a: store.a, b: store.b, c: store.c };
        });

        await flushPromises();
        expect(result).toEqual({ a: 0, b: 0, c: 0 });

        store.a = 1;
        store.b = 2;
        store.c = 3;

        await flushPromises();
        // Effect should see all final values
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('multiple properties changed in sequence', async () => {
        const store = createStore({ name: 'John', age: 30, city: 'NYC' });
        let runs = 0;

        effect(() => {
            store.name;
            store.age;
            store.city;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.name = 'Jane';
        store.age = 25;
        store.city = 'LA';

        await flushPromises();
        expect(runs).toBe(2); // Single batched run
    });

    it('nested object updates are batched', async () => {
        const store = createStore({ user: { profile: { name: 'John', email: 'john@example.com' } } });
        let runs = 0;

        effect(() => {
            store.user.profile.name;
            store.user.profile.email;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.user.profile.name = 'Jane';
        store.user.profile.email = 'jane@example.com';

        await flushPromises();
        expect(runs).toBe(2); // Batched
    });

    it('array mutations are batched', async () => {
        const store = createStore({ items: [1, 2, 3] });
        let runs = 0;
        /** @type {number[]} */
        let lastItems = [];

        effect(() => {
            runs++;
            lastItems = [...store.items];
        });

        await flushPromises();
        expect(runs).toBe(1);
        expect(lastItems).toEqual([1, 2, 3]);

        store.items.push(4);
        store.items.push(5);
        store.items.push(6);

        await flushPromises();
        expect(runs).toBe(2); // Batched
        expect(lastItems).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('computed values are recalculated once per batch', async () => {
        let computeCount = 0;
        const store = createStore({ a: 1, b: 2 });

        const sum = computed(() => {
            computeCount++;
            return store.a + store.b;
        });

        effect(() => {
            sum.value;
        });

        await flushPromises();
        expect(computeCount).toBe(1);

        store.a = 10;
        store.b = 20;

        // Access computed before flush - should recompute
        expect(sum.value).toBe(30);
        expect(computeCount).toBe(2);

        await flushPromises();
        // Effect ran once, computed was already fresh
        expect(computeCount).toBe(2);
    });

    it('same value set multiple times does not trigger updates', async () => {
        const store = createStore({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Set same value multiple times
        store.value = 0;
        store.value = 0;
        store.value = 0;

        await flushPromises();
        expect(runs).toBe(1); // No additional runs
    });

    it('rapid updates and then revert', async () => {
        const store = createStore({ value: 10 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Change and revert
        store.value = 20;
        store.value = 30;
        store.value = 10; // Back to original

        await flushPromises();
        // Still triggers because we track that a change happened
        // Even if the final value is the same as the starting value
        expect(runs).toBe(2);
    });

    it('multiple effects on same store are batched together', async () => {
        const store = createStore({ value: 0 });
        /** @type {string[]} */
        const calls = [];

        effect(() => {
            calls.push(`effect1:${store.value}`);
        });

        effect(() => {
            calls.push(`effect2:${store.value}`);
        });

        effect(() => {
            calls.push(`effect3:${store.value}`);
        });

        await flushPromises();
        expect(calls).toEqual(['effect1:0', 'effect2:0', 'effect3:0']);

        calls.length = 0;
        store.value = 1;

        await flushPromises();
        expect(calls).toEqual(['effect1:1', 'effect2:1', 'effect3:1']);
    });

    it('effects from multiple stores are batched', async () => {
        const store1 = createStore({ a: 0 });
        const store2 = createStore({ b: 0 });
        let runs = 0;

        effect(() => {
            store1.a;
            store2.b;
            runs++;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store1.a = 1;
        store2.b = 1;

        await flushPromises();
        expect(runs).toBe(2); // Batched into single run
    });

    it('effect runs in microtask, not synchronously', async () => {
        const store = createStore({ value: 0 });
        const log = [];

        effect(() => {
            log.push(`effect:${store.value}`);
        });

        log.push('after-effect-setup');

        await flushPromises();
        expect(log).toEqual(['after-effect-setup', 'effect:0']);

        store.value = 1;
        log.push('after-change');

        expect(log).toEqual(['after-effect-setup', 'effect:0', 'after-change']);

        await flushPromises();
        expect(log).toEqual(['after-effect-setup', 'effect:0', 'after-change', 'effect:1']);
    });

    it('changes during effect execution are also batched', async () => {
        const store = createStore({ value: 0 });
        let runs = 0;

        effect(() => {
            runs++;
            // Reading value
            const v = store.value;
            // If this is the initial run and value is 0, change it
            if (v === 0) {
                // This change should not cause immediate re-run
                // but should be batched for the next tick
                store.value = 1;
            }
        });

        await flushPromises();
        // First run sees 0 and changes to 1
        // This triggers another run which sees 1
        expect(runs).toBe(2);
        expect(store.value).toBe(1);
    });
});
