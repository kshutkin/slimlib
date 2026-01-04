import { describe, expect, it, vi } from 'vitest';

import { computed, createStore, effect } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('computed', () => {
    it('returns computed value', () => {
        const store = createStore({ count: 2 });

        const doubled = computed(() => store.count * 2);

        expect(doubled.value).toBe(4);
    });

    it('caches value until dependencies change', async () => {
        let computeCount = 0;
        const store = createStore({ count: 2 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        // First access computes
        expect(doubled.value).toBe(4);
        expect(computeCount).toBe(1);

        // Second access uses cache
        expect(doubled.value).toBe(4);
        expect(computeCount).toBe(1);

        // Change dependency
        store.count = 3;

        // Next access recomputes
        expect(doubled.value).toBe(6);
        expect(computeCount).toBe(2);

        // Cache again
        expect(doubled.value).toBe(6);
        expect(computeCount).toBe(2);
    });

    it('is lazy - does not compute until accessed', async () => {
        let computeCount = 0;
        const store = createStore({ count: 0 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        store.count = 1;
        store.count = 2;
        await flushPromises();

        expect(computeCount).toBe(0); // Never accessed, never computed

        doubled.value; // Now it computes
        expect(computeCount).toBe(1);
    });

    it('computed depending on computed', () => {
        const store = createStore({ count: 1 });

        const doubled = computed(() => store.count * 2);
        const quadrupled = computed(() => doubled.value * 2);

        expect(quadrupled.value).toBe(4);

        store.count = 2;
        expect(quadrupled.value).toBe(8);

        store.count = 5;
        expect(quadrupled.value).toBe(20);
    });

    it('chain of computed values', () => {
        const store = createStore({ value: 1 });

        const a = computed(() => store.value + 1);
        const b = computed(() => a.value + 1);
        const c = computed(() => b.value + 1);
        const d = computed(() => c.value + 1);

        expect(d.value).toBe(5);

        store.value = 10;
        expect(d.value).toBe(14);
    });

    it('effect can depend on computed', async () => {
        let effectRuns = 0;
        const store = createStore({ count: 1 });

        const doubled = computed(() => store.count * 2);

        effect(() => {
            effectRuns++;
            doubled.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushPromises();
        expect(effectRuns).toBe(2);
    });

    it('effect runs once when multiple computed values change', async () => {
        let effectRuns = 0;
        const store = createStore({ count: 1 });

        const doubled = computed(() => store.count * 2);
        const tripled = computed(() => store.count * 3);

        effect(() => {
            effectRuns++;
            doubled.value;
            tripled.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushPromises();
        // Effect should run only once, not twice
        expect(effectRuns).toBe(2);
    });

    it('handles nested object access in computed', () => {
        const store = createStore({ user: { profile: { name: 'John' } } });

        const name = computed(() => store.user.profile.name.toUpperCase());

        expect(name.value).toBe('JOHN');

        store.user.profile.name = 'Jane';
        expect(name.value).toBe('JANE');
    });

    it('computed with array methods', () => {
        const store = createStore({ items: [1, 2, 3, 4, 5] });

        const sum = computed(() => store.items.reduce((a, b) => a + b, 0));
        const filtered = computed(() => store.items.filter(x => x > 2));

        expect(sum.value).toBe(15);
        expect(filtered.value).toEqual([3, 4, 5]);

        store.items.push(6);
        expect(sum.value).toBe(21);
        expect(filtered.value).toEqual([3, 4, 5, 6]);
    });

    it('handles circular dependency gracefully', () => {
        const a = computed(() => b.value + 1);
        const b = computed(() => a.value + 1);

        // Circular dependencies return cached value (undefined initially)
        // a accesses b, b accesses a (still undefined), b returns NaN, a returns NaN
        expect(Number.isNaN(a.value)).toBe(true);
    });

    it('computed only recalculates when dirty', async () => {
        let computeCount = 0;
        const store = createStore({ count: 0 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        // First access
        doubled.value;
        expect(computeCount).toBe(1);

        // Access without change
        doubled.value;
        doubled.value;
        doubled.value;
        expect(computeCount).toBe(1);

        // Change and access
        store.count = 1;
        doubled.value;
        expect(computeCount).toBe(2);
    });

    it('multiple computed from same source', () => {
        const store = createStore({ value: 10 });

        const plus1 = computed(() => store.value + 1);
        const plus2 = computed(() => store.value + 2);
        const times2 = computed(() => store.value * 2);

        expect(plus1.value).toBe(11);
        expect(plus2.value).toBe(12);
        expect(times2.value).toBe(20);

        store.value = 100;

        expect(plus1.value).toBe(101);
        expect(plus2.value).toBe(102);
        expect(times2.value).toBe(200);
    });

    it('computed with conditional dependencies', async () => {
        let computeCount = 0;
        const store = createStore({ flag: true, a: 1, b: 2 });

        const result = computed(() => {
            computeCount++;
            return store.flag ? store.a : store.b;
        });

        expect(result.value).toBe(1);
        expect(computeCount).toBe(1);

        // Change b - should not cause recompute since flag is true
        store.b = 20;
        expect(result.value).toBe(1);
        // Note: computed will recompute because we use a simple dirty flag
        // A more sophisticated implementation would track dependencies per-run
        // For this implementation, changing any tracked property marks dirty

        // Change flag
        store.flag = false;
        expect(result.value).toBe(20);

        // Change a - should not cause recompute since flag is now false
        store.a = 100;
        expect(result.value).toBe(20);
    });

    it('computed value is readonly', () => {
        const store = createStore({ count: 1 });
        const doubled = computed(() => store.count * 2);

        expect(() => {
            // @ts-expect-error - intentionally testing readonly
            doubled.value = 10;
        }).toThrow();
    });

    it('effect with computed chain reruns once per source change', async () => {
        let effectRuns = 0;
        const store = createStore({ a: 1 });

        const b = computed(() => store.a + 1);
        const c = computed(() => b.value + 1);

        effect(() => {
            effectRuns++;
            c.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.a = 2;
        await flushPromises();
        expect(effectRuns).toBe(2);

        store.a = 3;
        await flushPromises();
        expect(effectRuns).toBe(3);
    });

    it('computed handles undefined values', () => {
        const store = createStore({ value: undefined });

        const doubled = computed(() => {
            const v = store.value;
            return v === undefined ? 'undefined' : v * 2;
        });

        expect(doubled.value).toBe('undefined');

        store.value = 5;
        expect(doubled.value).toBe(10);

        store.value = undefined;
        expect(doubled.value).toBe('undefined');
    });

    it('computed handles null values', () => {
        const store = createStore({ value: null });

        const isNull = computed(() => store.value === null);

        expect(isNull.value).toBe(true);

        store.value = 'something';
        expect(isNull.value).toBe(false);
    });

    it('computed restores dirty flag on error and can retry', () => {
        let shouldThrow = true;
        const store = createStore({ value: 1 });

        const comp = computed(() => {
            if (shouldThrow) {
                throw new Error('Computation failed');
            }
            return store.value * 2;
        });

        // First access should throw
        expect(() => comp.value).toThrow('Computation failed');

        // After error, we can fix the issue and retry
        shouldThrow = false;

        // Now it should work
        expect(comp.value).toBe(2);

        // And caching should work normally
        store.value = 5;
        expect(comp.value).toBe(10);
    });

    it('computed error does not corrupt state for subsequent access', () => {
        let throwCount = 0;
        const store = createStore({ value: 1 });

        const comp = computed(() => {
            throwCount++;
            if (throwCount <= 2) {
                throw new Error(`Error #${throwCount}`);
            }
            return store.value * 2;
        });

        // First two accesses should throw
        expect(() => comp.value).toThrow('Error #1');
        expect(() => comp.value).toThrow('Error #2');

        // Third access should succeed
        expect(comp.value).toBe(2);

        // After success, it should be cached
        expect(comp.value).toBe(2);
        expect(throwCount).toBe(3);
    });

    it('effect depending on computed clears sources properly on dispose', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        const dispose = effect(() => {
            effectRuns++;
            doubled.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        // Dispose the effect
        dispose();

        // Change the store - effect should NOT run
        store.value = 5;
        await flushPromises();
        expect(effectRuns).toBe(1);

        // Computed should still work independently
        expect(doubled.value).toBe(10);
    });

    it('computed depending on computed clears sources when dependency changes', () => {
        const store = createStore({ value: 1 });

        const first = computed(() => store.value * 2);
        const second = computed(() => first.value + 10);

        // Access to set up dependencies
        expect(second.value).toBe(12);

        // Change store
        store.value = 5;

        // Both should update
        expect(first.value).toBe(10);
        expect(second.value).toBe(20);
    });

    it('effect on computed chain properly clears computed dependencies on dispose', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;

        const a = computed(() => store.value + 1);
        const b = computed(() => a.value + 1);

        const dispose = effect(() => {
            effectRuns++;
            b.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        dispose();

        // Changes should not trigger effect
        store.value = 10;
        await flushPromises();
        expect(effectRuns).toBe(1);
    });

    it('disposed effect is not run when flush happens', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;

        const dispose = effect(() => {
            effectRuns++;
            store.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        // Change store to trigger effect (it gets batched)
        store.value = 2;

        // Immediately dispose before flush happens
        dispose();

        await flushPromises();
        // Effect should NOT have run because it was disposed before flush
        expect(effectRuns).toBe(1);
    });

    it('effect marked dirty multiple times only runs once', async () => {
        const store = createStore({ a: 1, b: 2 });
        let runs = 0;

        effect(() => {
            runs++;
            store.a;
            store.b;
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Change multiple tracked properties
        store.a = 10;
        store.b = 20;

        await flushPromises();
        // Should only run once despite two changes
        expect(runs).toBe(2);
    });

    it('computed accessed from multiple effects handles dependency cleanup', async () => {
        const store = createStore({ value: 1 });
        let effect1Runs = 0;
        let effect2Runs = 0;

        const doubled = computed(() => store.value * 2);

        const dispose1 = effect(() => {
            effect1Runs++;
            doubled.value;
        });

        effect(() => {
            effect2Runs++;
            doubled.value;
        });

        await flushPromises();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        // Dispose first effect
        dispose1();

        // Change should only trigger second effect
        store.value = 5;
        await flushPromises();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(2);
    });
    it('effect clears computed from sources when re-running (exercises clearSources computed branch)', async () => {
        const store = createStore({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        // This effect depends on a computed
        const dispose = effect(() => {
            effectRuns++;
            // Access computed - this adds { computed: doubled } to effect's sources
            return doubled.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(doubled.value).toBe(2);

        // Change store - triggers effect to re-run
        // When effect re-runs, clearSources is called which should hit
        // the `else if (source.computed)` branch
        store.value = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(doubled.value).toBe(10);

        // Dispose to also test cleanup of computed sources
        dispose();
    });

    it('disposing effect with computed dependency clears computed sources', async () => {
        const store = createStore({ value: 1 });
        let computeRuns = 0;

        const doubled = computed(() => {
            computeRuns++;
            return store.value * 2;
        });

        const dispose = effect(() => {
            doubled.value;
        });

        await flushPromises();
        expect(computeRuns).toBe(1);

        // Dispose effect - this should clear the computed from sources
        // exercising the `else if (source.computed)` branch in clearSources
        dispose();

        // Change store - computed should still work but effect shouldn't run
        store.value = 10;
        expect(doubled.value).toBe(20);
        expect(computeRuns).toBe(2);
    });

    it('effect already not dirty when flush runs (node[dirty] is false)', async () => {
        const store = createStore({ value: 0 });
        let effectRuns = 0;

        const dispose = effect(() => {
            effectRuns++;
            store.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        // Trigger a change - effect gets batched and marked dirty
        store.value = 1;

        // Dispose effect - this removes from batched AND clears dirty indirectly
        // by removing from the batch before it runs
        dispose();

        await flushPromises();
        // Effect should NOT have run because it was removed from batch
        expect(effectRuns).toBe(1);
    });

    it('computed chain with effect exercises computed source clearing', async () => {
        const store = createStore({ x: 1 });
        let effectRuns = 0;

        // Chain of computed values
        const a = computed(() => store.x + 1);
        const b = computed(() => a.value + 1);
        const c = computed(() => b.value + 1);

        // Effect depends on end of chain
        effect(() => {
            effectRuns++;
            c.value;
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(c.value).toBe(4); // 1 + 1 + 1 + 1

        // Change triggers chain update
        // Each computed re-evaluates and clears/re-establishes sources
        store.x = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(c.value).toBe(13); // 10 + 1 + 1 + 1
    });
});
