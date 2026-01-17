import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    // First yield to microtask queue to let scheduled effects be queued
    await Promise.resolve();
    // Then flush any pending effects
    flushEffects();
    await flushPromises();
}

describe('automatic batching', () => {
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

    it('multiple synchronous updates result in single effect run', async () => {
        const store = state({ count: 0 });
        let runs = 0;

        effect(() => {
            store.count;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1); // Initial run

        // Multiple synchronous updates
        store.count = 1;
        store.count = 2;
        store.count = 3;

        await flushAll();
        expect(runs).toBe(2); // Only one additional run
        expect(store.count).toBe(3); // Final value is correct
    });

    it('effect sees final values after batch', async () => {
        const store = state({ a: 0, b: 0, c: 0 });
        let result = {};

        effect(() => {
            result = { a: store.a, b: store.b, c: store.c };
        });

        await flushAll();
        expect(result).toEqual({ a: 0, b: 0, c: 0 });

        store.a = 1;
        store.b = 2;
        store.c = 3;

        await flushAll();
        // Effect should see all final values
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('multiple properties changed in sequence', async () => {
        const store = state({ name: 'John', age: 30, city: 'NYC' });
        let runs = 0;

        effect(() => {
            store.name;
            store.age;
            store.city;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        store.name = 'Jane';
        store.age = 25;
        store.city = 'LA';

        await flushAll();
        expect(runs).toBe(2); // Single batched run
    });

    it('nested object updates are batched', async () => {
        const store = state({ user: { profile: { name: 'John', email: 'john@example.com' } } });
        let runs = 0;

        effect(() => {
            store.user.profile.name;
            store.user.profile.email;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        store.user.profile.name = 'Jane';
        store.user.profile.email = 'jane@example.com';

        await flushAll();
        expect(runs).toBe(2); // Batched
    });

    it('array mutations are batched', async () => {
        const store = state({ items: [1, 2, 3] });
        let runs = 0;
        /** @type {number[]} */
        let lastItems = [];

        effect(() => {
            runs++;
            lastItems = [...store.items];
        });

        await flushAll();
        expect(runs).toBe(1);
        expect(lastItems).toEqual([1, 2, 3]);

        store.items.push(4);
        store.items.push(5);
        store.items.push(6);

        await flushAll();
        expect(runs).toBe(2); // Batched
        expect(lastItems).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('computed values are recalculated once per batch', async () => {
        let computeCount = 0;
        const store = state({ a: 1, b: 2 });

        const sum = computed(() => {
            computeCount++;
            return store.a + store.b;
        });

        effect(() => {
            sum();
        });

        await flushAll();
        expect(computeCount).toBe(1);

        store.a = 10;
        store.b = 20;

        // Access computed before flush - should recompute
        expect(sum()).toBe(30);
        expect(computeCount).toBe(2);

        await flushAll();
        // Effect ran once, computed was already fresh
        expect(computeCount).toBe(2);
    });

    it('same value set multiple times does not trigger updates', async () => {
        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Set same value multiple times
        store.value = 0;
        store.value = 0;
        store.value = 0;

        await flushAll();
        expect(runs).toBe(1); // No additional runs
    });

    it('rapid updates and then revert', async () => {
        const store = state({ value: 10 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Change and revert
        store.value = 20;
        store.value = 30;
        store.value = 10; // Back to original

        await flushAll();
        // Still triggers because we track that a change happened
        // Even if the final value is the same as the starting value
        expect(runs).toBe(2);
    });

    it('multiple effects on same store are batched together', async () => {
        const store = state({ value: 0 });
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

        await flushAll();
        expect(calls).toEqual(['effect1:0', 'effect2:0', 'effect3:0']);

        calls.length = 0;
        store.value = 1;

        await flushAll();
        expect(calls).toEqual(['effect1:1', 'effect2:1', 'effect3:1']);
    });

    it('effects from multiple stores are batched', async () => {
        const store1 = state({ a: 0 });
        const store2 = state({ b: 0 });
        let runs = 0;

        effect(() => {
            store1.a;
            store2.b;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        store1.a = 1;
        store2.b = 1;

        await flushPromises();
        expect(runs).toBe(2); // Batched into single run
    });

    it('effect runs in microtask, not synchronously', async () => {
        const store = state({ value: 0 });
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

    it('effect modifying multiple dependencies during execution re-batches once', async () => {
        // This tests the branch in batchedAdd where node.n !== undefined
        // When an effect modifies multiple dependencies during execution:
        // 1. First modification: node.n is undefined -> adds to batched list
        // 2. Second modification: node.n is defined -> hits early return branch
        const store = state({ a: 0, b: 0 });
        let runs = 0;

        effect(() => {
            runs++;
            const a = store.a;
            const b = store.b;
            if (a === 0 && b === 0) {
                // Modify multiple dependencies during effect execution
                // First change adds effect to new batched list (node.n becomes defined)
                // Second change calls batchedAdd but node.n !== undefined (early return)
                store.a = 1;
                store.b = 1;
            }
        });

        await flushAll();
        // Initial run (a=0, b=0) triggers modifications
        // Effect is re-scheduled and runs again (a=1, b=1)
        expect(runs).toBe(2);
        expect(store.a).toBe(1);
        expect(store.b).toBe(1);
    });

    it('effect marked dirty multiple times before flush only runs once', async () => {
        // This tests the branch in batchedAdd where node.n !== undefined
        // (effect is already in batched list when marked dirty again)
        const store1 = state({ a: 0 });
        const store2 = state({ b: 0 });
        const store3 = state({ c: 0 });
        let runs = 0;

        effect(() => {
            // Effect depends on all three stores
            store1.a;
            store2.b;
            store3.c;
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Change all three stores synchronously
        // First change adds effect to batched list
        // Second and third changes call batchedAdd but effect is already in list
        // so they should hit the early return branch (node.n !== undefined)
        store1.a = 1;
        store2.b = 1;
        store3.c = 1;

        await flushAll();
        // Effect should only run once despite 3 dependency changes
        expect(runs).toBe(2);
    });

    it('changes during effect execution are also batched', async () => {
        const store = state({ value: 0 });
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

describe('automatic batching with signals', () => {
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

    it('multiple synchronous updates result in single effect run', async () => {
        const count = signal(0);
        let runs = 0;

        effect(() => {
            count();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1); // Initial run

        // Multiple synchronous updates
        count.set(1);
        count.set(2);
        count.set(3);

        await flushAll();
        expect(runs).toBe(2); // Only one additional run
        expect(count()).toBe(3); // Final value is correct
    });

    it('effect sees final values after batch', async () => {
        const a = signal(0);
        const b = signal(0);
        const c = signal(0);
        /** @type {{ a: number, b: number, c: number }} */
        let result = { a: 0, b: 0, c: 0 };

        effect(() => {
            result = { a: a(), b: b(), c: c() };
        });

        await flushAll();
        expect(result).toEqual({ a: 0, b: 0, c: 0 });

        a.set(1);
        b.set(2);
        c.set(3);

        await flushAll();
        // Effect should see all final values
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('multiple signals changed in sequence', async () => {
        const name = signal('John');
        const age = signal(30);
        const city = signal('NYC');
        let runs = 0;

        effect(() => {
            name();
            age();
            city();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        name.set('Jane');
        age.set(25);
        city.set('LA');

        await flushAll();
        expect(runs).toBe(2); // Single batched run
    });

    it('computed values are recalculated once per batch', async () => {
        let computeCount = 0;
        const a = signal(1);
        const b = signal(2);

        const sum = computed(() => {
            computeCount++;
            return a() + b();
        });

        effect(() => {
            sum();
        });

        await flushAll();
        expect(computeCount).toBe(1);

        a.set(10);
        b.set(20);

        // Access computed before flush - should recompute
        expect(sum()).toBe(30);
        expect(computeCount).toBe(2);

        await flushAll();
        // Effect ran once, computed was already fresh
        expect(computeCount).toBe(2);
    });

    it('same value set multiple times does not trigger updates', async () => {
        const value = signal(0);
        let runs = 0;

        effect(() => {
            value();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Set same value multiple times
        value.set(0);
        value.set(0);
        value.set(0);

        await flushAll();
        expect(runs).toBe(1); // No additional runs
    });

    it('rapid updates and then revert', async () => {
        const value = signal(10);
        let runs = 0;

        effect(() => {
            value();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Change and revert
        value.set(20);
        value.set(30);
        value.set(10); // Back to original

        await flushAll();
        // Still triggers because we track that a change happened
        // Even if the final value is the same as the starting value
        expect(runs).toBe(2);
    });

    it('multiple effects on same signal are batched together', async () => {
        const value = signal(0);
        /** @type {string[]} */
        const calls = [];

        effect(() => {
            calls.push(`effect1:${value()}`);
        });

        effect(() => {
            calls.push(`effect2:${value()}`);
        });

        effect(() => {
            calls.push(`effect3:${value()}`);
        });

        await flushAll();
        expect(calls).toEqual(['effect1:0', 'effect2:0', 'effect3:0']);

        calls.length = 0;
        value.set(1);

        await flushAll();
        expect(calls).toEqual(['effect1:1', 'effect2:1', 'effect3:1']);
    });

    it('effects from multiple signals are batched', async () => {
        const a = signal(0);
        const b = signal(0);
        let runs = 0;

        effect(() => {
            a();
            b();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        a.set(1);
        b.set(1);

        await flushPromises();
        expect(runs).toBe(2); // Batched into single run
    });

    it('effect runs in microtask, not synchronously', async () => {
        const value = signal(0);
        /** @type {string[]} */
        const log = [];

        effect(() => {
            log.push(`effect:${value()}`);
        });

        log.push('after-effect-setup');

        await flushPromises();
        expect(log).toEqual(['after-effect-setup', 'effect:0']);

        value.set(1);
        log.push('after-change');

        expect(log).toEqual(['after-effect-setup', 'effect:0', 'after-change']);

        await flushPromises();
        expect(log).toEqual(['after-effect-setup', 'effect:0', 'after-change', 'effect:1']);
    });

    it('effect modifying multiple dependencies during execution re-batches once', async () => {
        // This tests the branch in batchedAdd where node.n !== undefined
        // When an effect modifies multiple dependencies during execution:
        // 1. First modification: node.n is undefined -> adds to batched list
        // 2. Second modification: node.n is defined -> hits early return branch
        const a = signal(0);
        const b = signal(0);
        let runs = 0;

        effect(() => {
            runs++;
            const aVal = a();
            const bVal = b();
            if (aVal === 0 && bVal === 0) {
                // Modify multiple dependencies during effect execution
                // First change adds effect to new batched list (node.n becomes defined)
                // Second change calls batchedAdd but node.n !== undefined (early return)
                a.set(1);
                b.set(1);
            }
        });

        await flushAll();
        // Initial run (a=0, b=0) triggers modifications
        // Effect is re-scheduled and runs again (a=1, b=1)
        expect(runs).toBe(2);
        expect(a()).toBe(1);
        expect(b()).toBe(1);
    });

    it('effect marked dirty multiple times before flush only runs once', async () => {
        // This tests the branch in batchedAdd where node.n !== undefined
        // (effect is already in batched list when marked dirty again)
        const a = signal(0);
        const b = signal(0);
        const c = signal(0);
        let runs = 0;

        effect(() => {
            // Effect depends on all three signals
            a();
            b();
            c();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        // Change all three signals synchronously
        // First change adds effect to batched list
        // Second and third changes call batchedAdd but effect is already in list
        // so they should hit the early return branch (node.n !== undefined)
        a.set(1);
        b.set(1);
        c.set(1);

        await flushAll();
        // Effect should only run once despite 3 dependency changes
        expect(runs).toBe(2);
    });

    it('changes during effect execution are also batched', async () => {
        const value = signal(0);
        let runs = 0;

        effect(() => {
            runs++;
            // Reading value
            const v = value();
            // If this is the initial run and value is 0, change it
            if (v === 0) {
                // This change should not cause immediate re-run
                // but should be batched for the next tick
                value.set(1);
            }
        });

        await flushPromises();
        // First run sees 0 and changes to 1
        // This triggers another run which sees 1
        expect(runs).toBe(2);
        expect(value()).toBe(1);
    });
});
