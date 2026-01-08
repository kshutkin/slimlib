import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, state } from '../src/index.js';

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

describe('effect', () => {
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

    it('runs effect on next microtask', async () => {
        const subscriber = vi.fn();
        const store = state({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        // Effect should not run synchronously
        expect(subscriber).toHaveBeenCalledTimes(0);

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);
    });

    it('re-runs when dependencies change', async () => {
        const subscriber = vi.fn();
        const store = state({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        store.count = 1;
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(2);
        expect(subscriber).toHaveBeenLastCalledWith(1);

        store.count = 2;
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(3);
        expect(subscriber).toHaveBeenLastCalledWith(2);
    });

    it('does not re-run when untracked properties change', async () => {
        const subscriber = vi.fn();
        const store = state({ tracked: 0, untracked: 0 });

        effect(() => {
            subscriber(store.tracked);
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing untracked property should not trigger effect
        store.untracked = 1;
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing tracked property should trigger effect
        store.tracked = 1;
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('supports cleanup function', async () => {
        let cleanupCalled = false;
        const store = state({ count: 0 });

        effect(() => {
            store.count; // Track dependency
            return () => {
                cleanupCalled = true;
            };
        });

        await flushAll();
        expect(cleanupCalled).toBe(false);

        store.count = 1;
        await flushAll();
        expect(cleanupCalled).toBe(true);
    });

    it('cleanup is called before each re-run', async () => {
        /** @type {string[]} */
        const calls = [];
        const store = state({ count: 0 });

        effect(() => {
            const currentCount = store.count;
            calls.push(`run:${currentCount}`);
            return () => {
                // Cleanup captures the value at the time it was created
                calls.push(`cleanup:${currentCount}`);
            };
        });

        await flushAll();
        expect(calls).toEqual(['run:0']);

        store.count = 1;
        await flushAll();
        // Cleanup runs with old value captured in closure
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1']);

        store.count = 2;
        await flushAll();
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
    });

    it('dispose stops effect from running', async () => {
        const subscriber = vi.fn();
        const store = state({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        dispose();

        store.count = 1;
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('dispose calls cleanup function', async () => {
        let cleanupCalled = false;
        const store = state({ count: 0 });

        const dispose = effect(() => {
            store.count;
            return () => {
                cleanupCalled = true;
            };
        });

        await flushAll();
        expect(cleanupCalled).toBe(false);

        dispose();
        expect(cleanupCalled).toBe(true);
    });

    it('tracks nested object properties', async () => {
        const subscriber = vi.fn();
        const store = state({ user: { name: 'John', age: 30 } });

        effect(() => {
            subscriber(store.user.name);
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledWith('John');

        store.user.name = 'Jane';
        await flushAll();
        expect(subscriber).toHaveBeenCalledWith('Jane');
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('only tracks accessed properties', async () => {
        let nameRuns = 0;
        let ageRuns = 0;
        const store = state({ user: { name: 'John', age: 30 } });

        effect(() => {
            store.user.name;
            nameRuns++;
        });

        effect(() => {
            store.user.age;
            ageRuns++;
        });

        await flushAll();
        expect(nameRuns).toBe(1);
        expect(ageRuns).toBe(1);

        store.user.name = 'Jane';
        await flushAll();
        expect(nameRuns).toBe(2);
        expect(ageRuns).toBe(1); // Age effect should not run

        store.user.age = 31;
        await flushAll();
        expect(nameRuns).toBe(2); // Name effect should not run
        expect(ageRuns).toBe(2);
    });

    it('handles conditional dependencies', async () => {
        let runs = 0;
        const store = state({ flag: true, a: 1, b: 2 });

        effect(() => {
            runs++;
            if (store.flag) {
                store.a;
            } else {
                store.b;
            }
        });

        await flushAll();
        expect(runs).toBe(1);

        // When flag is true, only 'a' and 'flag' are tracked
        store.b = 10;
        await flushAll();
        expect(runs).toBe(1); // Should NOT trigger

        store.a = 5;
        await flushAll();
        expect(runs).toBe(2); // SHOULD trigger

        // Now switch the flag
        store.flag = false;
        await flushAll();
        expect(runs).toBe(3);

        // Now 'b' and 'flag' should be tracked, not 'a'
        store.a = 100;
        await flushAll();
        expect(runs).toBe(3); // Should NOT trigger

        store.b = 20;
        await flushAll();
        expect(runs).toBe(4); // SHOULD trigger
    });

    it('handles array mutations', async () => {
        let runs = 0;
        const store = state({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            store.items.length;
        });

        await flushAll();
        expect(runs).toBe(1);

        store.items.push(4);
        await flushAll();
        expect(runs).toBe(2);
    });

    it('handles array iteration', async () => {
        let runs = 0;
        let sum = 0;
        const store = state({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            sum = 0;
            for (const item of store.items) {
                sum += item;
            }
        });

        await flushAll();
        expect(runs).toBe(1);
        expect(sum).toBe(6);

        store.items.push(4);
        await flushAll();
        expect(runs).toBe(2);
        expect(sum).toBe(10);
    });

    it('does not run if value is the same', async () => {
        let runs = 0;
        const store = state({ count: 0 });

        effect(() => {
            runs++;
            store.count;
        });

        await flushAll();
        expect(runs).toBe(1);

        store.count = 0; // Same value
        await flushAll();
        expect(runs).toBe(1); // Should not run
    });

    it('self-dispose within effect', async () => {
        let runs = 0;
        const store = state({ count: 0 });

        /** @type {() => void} */
        let dispose;
        dispose = effect(() => {
            runs++;
            if (store.count > 2) {
                dispose();
            }
        });

        await flushAll();
        expect(runs).toBe(1);

        store.count = 1;
        await flushAll();
        expect(runs).toBe(2);

        store.count = 3;
        await flushAll();
        expect(runs).toBe(3);

        // Effect disposed itself, further changes should not trigger
        store.count = 4;
        await flushAll();
        expect(runs).toBe(3);
    });

    it('multiple stores in single effect', async () => {
        let runs = 0;
        const store1 = state({ a: 1 });
        const store2 = state({ b: 2 });

        effect(() => {
            runs++;
            store1.a;
            store2.b;
        });

        await flushAll();
        expect(runs).toBe(1);

        store1.a = 10;
        await flushAll();
        expect(runs).toBe(2);

        store2.b = 20;
        await flushAll();
        expect(runs).toBe(3);
    });

    it('dispose before first run cancels effect', async () => {
        const subscriber = vi.fn();
        const store = state({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        // Dispose before microtask runs
        dispose();

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(0);
    });

    it('effect depending on computed clears computed sources on re-run', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        effect(() => {
            effectRuns++;
            // Access computed to create dependency
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Change store - triggers recompute and effect re-run
        // This clears and re-establishes the computed dependency
        store.value = 5;
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(doubled()).toBe(10);
    });

    it('effect disposed after being marked dirty but before flush', async () => {
        const subscriber = vi.fn();
        const store = state({ value: 0 });

        const dispose = effect(() => {
            subscriber(store.value);
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);

        // Change triggers batched update
        store.value = 1;

        // Dispose immediately - before the microtask runs
        dispose();

        await flushAll();
        // Effect should NOT have run again because it was disposed
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('computed dependency is properly tracked in effect', async () => {
        const store = state({ a: 1, b: 2 });
        let effectRuns = 0;

        const sum = computed(() => store.a + store.b);

        effect(() => {
            effectRuns++;
            sum();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        store.a = 10;
        await flushAll();
        expect(effectRuns).toBe(2);

        store.b = 20;
        await flushAll();
        expect(effectRuns).toBe(3);
    });

    it('effect on computed chain clears sources properly on each run', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;
        let computeARuns = 0;
        let computeBRuns = 0;

        const a = computed(() => {
            computeARuns++;
            return store.value + 1;
        });

        const b = computed(() => {
            computeBRuns++;
            return a() * 2;
        });

        effect(() => {
            effectRuns++;
            b();
        });

        await flushAll();
        expect(effectRuns).toBe(1);
        expect(computeARuns).toBe(1);
        expect(computeBRuns).toBe(1);

        // Change store - all should update
        store.value = 5;
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(computeARuns).toBe(2);
        expect(computeBRuns).toBe(2);
    });

    it('multiple effects disposed before flush only run remaining ones', async () => {
        const store = state({ value: 0 });
        let effect1Runs = 0;
        let effect2Runs = 0;
        let effect3Runs = 0;

        const dispose1 = effect(() => {
            effect1Runs++;
            store.value;
        });

        const dispose2 = effect(() => {
            effect2Runs++;
            store.value;
        });

        effect(() => {
            effect3Runs++;
            store.value;
        });

        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(1);

        // Trigger all effects
        store.value = 1;

        // Dispose first two before flush
        dispose1();
        dispose2();

        await flushAll();
        // Only effect3 should have run again
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(2);
    });

    it('effect disposed while another effect runs during flush', async () => {
        const store = state({ value: 0 });
        let effect1Runs = 0;
        let effect2Runs = 0;

        /** @type {() => void} */
        let dispose2;

        // Effect 1 disposes Effect 2 when it runs
        effect(() => {
            effect1Runs++;
            store.value;
            if (effect1Runs === 2 && dispose2) {
                dispose2();
            }
        });

        dispose2 = effect(() => {
            effect2Runs++;
            store.value;
        });

        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        // Change triggers both effects
        store.value = 1;

        await flushAll();
        // Effect 1 ran and disposed Effect 2
        // Effect 2 might or might not have run depending on order
        expect(effect1Runs).toBe(2);
    });

    it('effect that changes its own dependency during execution', async () => {
        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            runs++;
            const v = store.value;
            if (v < 3) {
                store.value = v + 1;
            }
        });

        await flushAll();
        // Effect runs multiple times as it keeps changing its dependency
        // Eventually stops when value reaches 3
        expect(store.value).toBe(3);
        expect(runs).toBeGreaterThanOrEqual(3);
    });

    it('computed depending on computed with effect exercises all code paths', async () => {
        const store = state({ base: 1 });
        let effectRuns = 0;

        const level1 = computed(() => store.base * 2);
        const level2 = computed(() => level1() + 10);
        const level3 = computed(() => level2() * 3);

        const dispose = effect(() => {
            effectRuns++;
            level3();
        });

        await flushAll();
        expect(effectRuns).toBe(1);
        expect(level3()).toBe(36); // ((1*2)+10)*3

        store.base = 5;
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(level3()).toBe(60); // ((5*2)+10)*3

        dispose();

        // After dispose, changes should not trigger effect
        store.base = 10;
        await flushAll();
        expect(effectRuns).toBe(2);
    });

    it('effect with only computed dependencies (no direct store access)', async () => {
        const store = state({ x: 1, y: 2 });
        let effectRuns = 0;

        const sum = computed(() => store.x + store.y);
        const product = computed(() => store.x * store.y);

        // Effect only accesses computed values, not store directly
        const dispose = effect(() => {
            effectRuns++;
            sum();
            product();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        store.x = 5;
        await flushAll();
        expect(effectRuns).toBe(2);

        // Dispose and verify cleanup
        dispose();

        store.y = 10;
        await flushAll();
        expect(effectRuns).toBe(2);
    });

    it('rapidly creating and disposing effects', async () => {
        const store = state({ value: 0 });
        const disposes = [];

        for (let i = 0; i < 10; i++) {
            disposes.push(
                effect(() => {
                    store.value;
                })
            );
        }

        // Dispose all before flush
        for (const d of disposes) {
            d();
        }

        await flushAll();
        // All effects were disposed before running
        // No errors should occur
    });

    it('effect re-run clears previous computed dependencies', async () => {
        const store = state({ flag: true, a: 1, b: 2 });
        let effectRuns = 0;

        const compA = computed(() => store.a * 2);
        const compB = computed(() => store.b * 3);

        effect(() => {
            effectRuns++;
            if (store.flag) {
                compA();
            } else {
                compB();
            }
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Change compA dependency - should trigger
        store.a = 10;
        await flushAll();
        expect(effectRuns).toBe(2);

        // Change compB dependency - should NOT trigger (not in current deps)
        store.b = 20;
        await flushAll();
        expect(effectRuns).toBe(2);

        // Switch branch
        store.flag = false;
        await flushAll();
        expect(effectRuns).toBe(3);

        // Now compA should not trigger
        store.a = 100;
        await flushAll();
        expect(effectRuns).toBe(3);

        // But compB should trigger
        store.b = 200;
        await flushAll();
        expect(effectRuns).toBe(4);
    });

    it('does not call truthy non-function return value as cleanup', async () => {
        const store = state({ count: 0 });
        let runs = 0;

        // Effect returns a truthy non-function value (an object)
        // If cleanup?.() was used instead of typeof check, this would throw
        // "cleanup is not a function" when the effect re-runs
        // @ts-expect-error
        effect(() => {
            store.count;
            runs++;
            return { notAFunction: true }; // truthy but not callable
        });

        await flushAll();
        expect(runs).toBe(1);

        // This should NOT throw - the typeof check should prevent calling the object
        store.count = 1;
        await flushAll();
        expect(runs).toBe(2);

        // Also test with other truthy non-function values
        store.count = 2;
        await flushAll();
        expect(runs).toBe(3);
    });
});
