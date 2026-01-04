import { describe, expect, it, vi } from 'vitest';

import { computed, createStore, effect } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('effect', () => {
    it('runs effect on next microtask', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        // Effect should not run synchronously
        expect(subscriber).toHaveBeenCalledTimes(0);

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);
    });

    it('re-runs when dependencies change', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        store.count = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(2);
        expect(subscriber).toHaveBeenLastCalledWith(1);

        store.count = 2;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(3);
        expect(subscriber).toHaveBeenLastCalledWith(2);
    });

    it('does not re-run when untracked properties change', async () => {
        const subscriber = vi.fn();
        const store = createStore({ tracked: 0, untracked: 0 });

        effect(() => {
            subscriber(store.tracked);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing untracked property should not trigger effect
        store.untracked = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing tracked property should trigger effect
        store.tracked = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('supports cleanup function', async () => {
        let cleanupCalled = false;
        const store = createStore({ count: 0 });

        effect(() => {
            store.count; // Track dependency
            return () => {
                cleanupCalled = true;
            };
        });

        await flushPromises();
        expect(cleanupCalled).toBe(false);

        store.count = 1;
        await flushPromises();
        expect(cleanupCalled).toBe(true);
    });

    it('cleanup is called before each re-run', async () => {
        /** @type {string[]} */
        const calls = [];
        const store = createStore({ count: 0 });

        effect(() => {
            const currentCount = store.count;
            calls.push(`run:${currentCount}`);
            return () => {
                // Cleanup captures the value at the time it was created
                calls.push(`cleanup:${currentCount}`);
            };
        });

        await flushPromises();
        expect(calls).toEqual(['run:0']);

        store.count = 1;
        await flushPromises();
        // Cleanup runs with old value captured in closure
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1']);

        store.count = 2;
        await flushPromises();
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
    });

    it('dispose stops effect from running', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        dispose();

        store.count = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('dispose calls cleanup function', async () => {
        let cleanupCalled = false;
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            store.count;
            return () => {
                cleanupCalled = true;
            };
        });

        await flushPromises();
        expect(cleanupCalled).toBe(false);

        dispose();
        expect(cleanupCalled).toBe(true);
    });

    it('tracks nested object properties', async () => {
        const subscriber = vi.fn();
        const store = createStore({ user: { name: 'John', age: 30 } });

        effect(() => {
            subscriber(store.user.name);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledWith('John');

        store.user.name = 'Jane';
        await flushPromises();
        expect(subscriber).toHaveBeenCalledWith('Jane');
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('only tracks accessed properties', async () => {
        let nameRuns = 0;
        let ageRuns = 0;
        const store = createStore({ user: { name: 'John', age: 30 } });

        effect(() => {
            store.user.name;
            nameRuns++;
        });

        effect(() => {
            store.user.age;
            ageRuns++;
        });

        await flushPromises();
        expect(nameRuns).toBe(1);
        expect(ageRuns).toBe(1);

        store.user.name = 'Jane';
        await flushPromises();
        expect(nameRuns).toBe(2);
        expect(ageRuns).toBe(1); // Age effect should not run

        store.user.age = 31;
        await flushPromises();
        expect(nameRuns).toBe(2); // Name effect should not run
        expect(ageRuns).toBe(2);
    });

    it('handles conditional dependencies', async () => {
        let runs = 0;
        const store = createStore({ flag: true, a: 1, b: 2 });

        effect(() => {
            runs++;
            if (store.flag) {
                store.a;
            } else {
                store.b;
            }
        });

        await flushPromises();
        expect(runs).toBe(1);

        // When flag is true, only 'a' and 'flag' are tracked
        store.b = 10;
        await flushPromises();
        expect(runs).toBe(1); // Should NOT trigger

        store.a = 5;
        await flushPromises();
        expect(runs).toBe(2); // SHOULD trigger

        // Now switch the flag
        store.flag = false;
        await flushPromises();
        expect(runs).toBe(3);

        // Now 'b' and 'flag' should be tracked, not 'a'
        store.a = 100;
        await flushPromises();
        expect(runs).toBe(3); // Should NOT trigger

        store.b = 20;
        await flushPromises();
        expect(runs).toBe(4); // SHOULD trigger
    });

    it('handles array mutations', async () => {
        let runs = 0;
        const store = createStore({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            store.items.length;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.items.push(4);
        await flushPromises();
        expect(runs).toBe(2);
    });

    it('handles array iteration', async () => {
        let runs = 0;
        let sum = 0;
        const store = createStore({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            sum = 0;
            for (const item of store.items) {
                sum += item;
            }
        });

        await flushPromises();
        expect(runs).toBe(1);
        expect(sum).toBe(6);

        store.items.push(4);
        await flushPromises();
        expect(runs).toBe(2);
        expect(sum).toBe(10);
    });

    it('does not run if value is the same', async () => {
        let runs = 0;
        const store = createStore({ count: 0 });

        effect(() => {
            runs++;
            store.count;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.count = 0; // Same value
        await flushPromises();
        expect(runs).toBe(1); // Should not run
    });

    it('self-dispose within effect', async () => {
        let runs = 0;
        const store = createStore({ count: 0 });

        /** @type {() => void} */
        let dispose;
        dispose = effect(() => {
            runs++;
            if (store.count > 2) {
                dispose();
            }
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.count = 1;
        await flushPromises();
        expect(runs).toBe(2);

        store.count = 3;
        await flushPromises();
        expect(runs).toBe(3);

        // Effect disposed itself, further changes should not trigger
        store.count = 4;
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('multiple stores in single effect', async () => {
        let runs = 0;
        const store1 = createStore({ a: 1 });
        const store2 = createStore({ b: 2 });

        effect(() => {
            runs++;
            store1.a;
            store2.b;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store1.a = 10;
        await flushPromises();
        expect(runs).toBe(2);

        store2.b = 20;
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('dispose before first run cancels effect', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        // Dispose before microtask runs
        dispose();

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(0);
    });

    it('effect depending on computed clears computed sources on re-run', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        effect(() => {
            effectRuns++;
            // Access computed to create dependency
            doubled.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        // Change store - triggers recompute and effect re-run
        // This clears and re-establishes the computed dependency
        store.value = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(doubled.value).toBe(10);
    });

    it('effect disposed after being marked dirty but before flush', async () => {
        const subscriber = vi.fn();
        const store = createStore({ value: 0 });

        const dispose = effect(() => {
            subscriber(store.value);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);

        // Change triggers batched update
        store.value = 1;

        // Dispose immediately - before the microtask runs
        dispose();

        await flushPromises();
        // Effect should NOT have run again because it was disposed
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('computed dependency is properly tracked in effect', async () => {
        const store = createStore({ a: 1, b: 2 });
        let effectRuns = 0;

        const sum = computed(() => store.a + store.b);

        effect(() => {
            effectRuns++;
            sum.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.a = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);

        store.b = 20;
        await flushPromises();
        expect(effectRuns).toBe(3);
    });

    it('effect on computed chain clears sources properly on each run', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;
        let computeARuns = 0;
        let computeBRuns = 0;

        const a = computed(() => {
            computeARuns++;
            return store.value + 1;
        });

        const b = computed(() => {
            computeBRuns++;
            return a.value * 2;
        });

        effect(() => {
            effectRuns++;
            b.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(computeARuns).toBe(1);
        expect(computeBRuns).toBe(1);

        // Change store - all should update
        store.value = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(computeARuns).toBe(2);
        expect(computeBRuns).toBe(2);
    });

    it('multiple effects disposed before flush only run remaining ones', async () => {
        const store = createStore({ value: 0 });
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

        await flushPromises();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(1);

        // Trigger all effects
        store.value = 1;

        // Dispose first two before flush
        dispose1();
        dispose2();

        await flushPromises();
        // Only effect3 should have run again
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(2);
    });

    it('effect disposed while another effect runs during flush', async () => {
        const store = createStore({ value: 0 });
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

        await flushPromises();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        // Change triggers both effects
        store.value = 1;

        await flushPromises();
        // Effect 1 ran and disposed Effect 2
        // Effect 2 might or might not have run depending on order
        expect(effect1Runs).toBe(2);
    });

    it('effect that changes its own dependency during execution', async () => {
        const store = createStore({ value: 0 });
        let runs = 0;

        effect(() => {
            runs++;
            const v = store.value;
            if (v < 3) {
                store.value = v + 1;
            }
        });

        await flushPromises();
        // Effect runs multiple times as it keeps changing its dependency
        // Eventually stops when value reaches 3
        expect(store.value).toBe(3);
        expect(runs).toBeGreaterThanOrEqual(3);
    });

    it('computed depending on computed with effect exercises all code paths', async () => {
        const store = createStore({ base: 1 });
        let effectRuns = 0;

        const level1 = computed(() => store.base * 2);
        const level2 = computed(() => level1.value + 10);
        const level3 = computed(() => level2.value * 3);

        const dispose = effect(() => {
            effectRuns++;
            level3.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(level3.value).toBe(36); // ((1*2)+10)*3

        store.base = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(level3.value).toBe(60); // ((5*2)+10)*3

        dispose();

        // After dispose, changes should not trigger effect
        store.base = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);
    });

    it('effect with only computed dependencies (no direct store access)', async () => {
        const store = createStore({ x: 1, y: 2 });
        let effectRuns = 0;

        const sum = computed(() => store.x + store.y);
        const product = computed(() => store.x * store.y);

        // Effect only accesses computed values, not store directly
        const dispose = effect(() => {
            effectRuns++;
            sum.value;
            product.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.x = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);

        // Dispose and verify cleanup
        dispose();

        store.y = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);
    });

    it('rapidly creating and disposing effects', async () => {
        const store = createStore({ value: 0 });
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

        await flushPromises();
        // All effects were disposed before running
        // No errors should occur
    });

    it('effect re-run clears previous computed dependencies', async () => {
        const store = createStore({ flag: true, a: 1, b: 2 });
        let effectRuns = 0;

        const compA = computed(() => store.a * 2);
        const compB = computed(() => store.b * 3);

        effect(() => {
            effectRuns++;
            if (store.flag) {
                compA.value;
            } else {
                compB.value;
            }
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        // Change compA dependency - should trigger
        store.a = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);

        // Change compB dependency - should NOT trigger (not in current deps)
        store.b = 20;
        await flushPromises();
        expect(effectRuns).toBe(2);

        // Switch branch
        store.flag = false;
        await flushPromises();
        expect(effectRuns).toBe(3);

        // Now compA should not trigger
        store.a = 100;
        await flushPromises();
        expect(effectRuns).toBe(3);

        // But compB should trigger
        store.b = 200;
        await flushPromises();
        expect(effectRuns).toBe(4);
    });
});
