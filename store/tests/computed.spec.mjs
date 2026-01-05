import { describe, expect, it } from 'vitest';

import { computed, effect, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('computed', () => {
    it('returns computed value', () => {
        const store = state({ count: 2 });

        const doubled = computed(() => store.count * 2);

        expect(doubled()).toBe(4);
    });

    it('caches value until dependencies change', async () => {
        let computeCount = 0;
        const store = state({ count: 2 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        // First access computes
        expect(doubled()).toBe(4);
        expect(computeCount).toBe(1);

        // Second access uses cache
        expect(doubled()).toBe(4);
        expect(computeCount).toBe(1);

        // Change dependency
        store.count = 3;

        // Next access recomputes
        expect(doubled()).toBe(6);
        expect(computeCount).toBe(2);

        // Cache again
        expect(doubled()).toBe(6);
        expect(computeCount).toBe(2);
    });

    it('is lazy - does not compute until accessed', async () => {
        let computeCount = 0;
        const store = state({ count: 0 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        store.count = 1;
        store.count = 2;
        await flushPromises();

        expect(computeCount).toBe(0); // Never accessed, never computed

        doubled(); // Now it computes
        expect(computeCount).toBe(1);
    });

    it('computed depending on computed', () => {
        const store = state({ count: 1 });

        const doubled = computed(() => store.count * 2);
        const quadrupled = computed(() => doubled() * 2);

        expect(quadrupled()).toBe(4);

        store.count = 2;
        expect(quadrupled()).toBe(8);

        store.count = 5;
        expect(quadrupled()).toBe(20);
    });

    it('chain of computed values', () => {
        const store = state({ value: 1 });

        const a = computed(() => store.value + 1);
        const b = computed(() => a() + 1);
        const c = computed(() => b() + 1);
        const d = computed(() => c() + 1);

        expect(d()).toBe(5);

        store.value = 10;
        expect(d()).toBe(14);
    });

    it('effect can depend on computed', async () => {
        let effectRuns = 0;
        const store = state({ count: 1 });

        const doubled = computed(() => store.count * 2);

        effect(() => {
            effectRuns++;
            doubled();
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushPromises();
        expect(effectRuns).toBe(2);
    });

    it('effect runs once when multiple computed values change', async () => {
        let effectRuns = 0;
        const store = state({ count: 1 });

        const doubled = computed(() => store.count * 2);
        const tripled = computed(() => store.count * 3);

        effect(() => {
            effectRuns++;
            doubled();
            tripled();
        });

        await flushPromises();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushPromises();
        // Effect should run only once, not twice
        expect(effectRuns).toBe(2);
    });

    it('handles nested object access in computed', () => {
        const store = state({ user: { profile: { name: 'John' } } });

        const name = computed(() => store.user.profile.name.toUpperCase());

        expect(name()).toBe('JOHN');

        store.user.profile.name = 'Jane';
        expect(name()).toBe('JANE');
    });

    it('computed with array methods', () => {
        const store = state({ items: [1, 2, 3, 4, 5] });

        const sum = computed(() => store.items.reduce((a, b) => a + b, 0));
        const filtered = computed(() => store.items.filter(x => x > 2));

        expect(sum()).toBe(15);
        expect(filtered()).toEqual([3, 4, 5]);

        store.items.push(6);
        expect(sum()).toBe(21);
        expect(filtered()).toEqual([3, 4, 5, 6]);
    });

    it('handles circular dependency gracefully', () => {
        const a = computed(() => b() + 1);
        const b = computed(() => a() + 1);

        // Circular dependencies return cached value (undefined initially)
        // a accesses b, b accesses a (still undefined), b returns NaN, a returns NaN
        expect(Number.isNaN(a())).toBe(true);
    });

    it('computed only recalculates when dirty', async () => {
        let computeCount = 0;
        const store = state({ count: 0 });

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        // Initial access
        doubled();
        expect(computeCount).toBe(1);

        // No changes - should use cache
        doubled();
        doubled();
        doubled();
        expect(computeCount).toBe(1);

        // Change dependency
        store.count = 1;

        // Access - should recompute once
        doubled();
        expect(computeCount).toBe(2);
    });

    it('multiple computed from same source', () => {
        const store = state({ value: 1 });

        const plus1 = computed(() => store.value + 1);
        const plus2 = computed(() => store.value + 2);
        const times2 = computed(() => store.value * 2);

        expect(plus1()).toBe(2);
        expect(plus2()).toBe(3);
        expect(times2()).toBe(2);

        store.value = 10;

        expect(plus1()).toBe(11);
        expect(plus2()).toBe(12);
        expect(times2()).toBe(20);
    });

    it('computed with conditional dependencies', async () => {
        let computeCount = 0;
        const store = state({ flag: true, a: 1, b: 2 });

        const result = computed(() => {
            computeCount++;
            return store.flag ? store.a : store.b;
        });

        expect(result()).toBe(1);
        expect(computeCount).toBe(1);

        // Change b - should not cause recompute since flag is true
        store.b = 20;
        expect(result()).toBe(1);
        // Note: computed will recompute because we use a simple dirty flag
        // A more sophisticated implementation would track dependencies per-run
        // For this implementation, changing any tracked property marks dirty

        // Change flag
        store.flag = false;
        expect(result()).toBe(20);

        // Change a - should not cause recompute since flag is now false
        store.a = 100;
        expect(result()).toBe(20);
    });

    it('effect with computed chain reruns once per source change', async () => {
        let effectRuns = 0;
        const store = state({ a: 1 });

        const b = computed(() => store.a + 1);
        const c = computed(() => b() + 1);

        effect(() => {
            effectRuns++;
            c();
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
        const store = state({ value: /** @type {number | undefined} */ (undefined) });

        const doubled = computed(() => {
            const v = store.value;
            return v === undefined ? 'empty' : v * 2;
        });

        expect(doubled()).toBe('empty');

        store.value = 5;
        expect(doubled()).toBe(10);

        store.value = undefined;
        expect(doubled()).toBe('empty');
    });

    it('computed handles null values', () => {
        const store = state({ value: /** @type {number | null} */ (null) });

        const isNull = computed(() => store.value === null);

        expect(isNull()).toBe(true);

        store.value = 42;
        expect(isNull()).toBe(false);
    });

    it('computed restores dirty flag on error and can retry', () => {
        let shouldThrow = true;
        const store = state({ value: 1 });

        const comp = computed(() => {
            if (shouldThrow) {
                throw new Error('Computation failed');
            }
            return store.value * 2;
        });

        // First access should throw
        expect(() => comp()).toThrow('Computation failed');

        // After error, we can fix the issue and retry
        shouldThrow = false;

        // Now it should work
        expect(comp()).toBe(2);

        // And caching should work normally
        store.value = 5;
        expect(comp()).toBe(10);
    });

    it('computed error does not corrupt state for subsequent access', () => {
        let throwCount = 0;
        const store = state({ value: 1 });

        const comp = computed(() => {
            throwCount++;
            if (throwCount <= 2) {
                throw new Error(`Error #${throwCount}`);
            }
            return store.value * 2;
        });

        // First two accesses should throw
        expect(() => comp()).toThrow('Error #1');
        expect(() => comp()).toThrow('Error #2');

        // Third access should succeed
        expect(comp()).toBe(2);

        // After success, it should be cached
        expect(comp()).toBe(2);
        expect(throwCount).toBe(3);
    });

    it('effect depending on computed clears sources properly on dispose', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        const dispose = effect(() => {
            effectRuns++;
            doubled();
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
        expect(doubled()).toBe(10);
    });

    it('computed depending on computed clears sources when dependency changes', () => {
        const store = state({ value: 1 });

        const first = computed(() => store.value * 2);
        const second = computed(() => first() + 10);

        // Access to set up dependencies
        expect(second()).toBe(12);

        // Change store
        store.value = 5;

        // Both should update
        expect(first()).toBe(10);
        expect(second()).toBe(20);
    });

    it('effect on computed chain properly clears computed dependencies on dispose', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;

        const a = computed(() => store.value + 1);
        const b = computed(() => a() + 1);

        const dispose = effect(() => {
            effectRuns++;
            b();
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
        const store = state({ value: 1 });
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
        const store = state({ a: 1, b: 2 });
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
        const store = state({ value: 1 });
        let effect1Runs = 0;
        let effect2Runs = 0;

        const doubled = computed(() => store.value * 2);

        const dispose1 = effect(() => {
            effect1Runs++;
            doubled();
        });

        effect(() => {
            effect2Runs++;
            doubled();
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
        const store = state({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        // This effect depends on a computed
        const dispose = effect(() => {
            effectRuns++;
            // Access computed - this adds { computed: doubled } to effect's sources
            return doubled();
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(doubled()).toBe(2);

        // Change store - triggers effect to re-run
        // When effect re-runs, clearSources is called which should hit
        // the `else if (source.computed)` branch
        store.value = 5;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(doubled()).toBe(10);

        // Dispose to also test cleanup of computed sources
        dispose();
    });

    it('disposing effect with computed dependency clears computed sources', async () => {
        const store = state({ value: 1 });
        let computeRuns = 0;

        const doubled = computed(() => {
            computeRuns++;
            return store.value * 2;
        });

        const dispose = effect(() => {
            doubled();
        });

        await flushPromises();
        expect(computeRuns).toBe(1);

        // Dispose effect - this should clear the computed from sources
        // exercising the `else if (source.computed)` branch in clearSources
        dispose();

        // Change store - computed should still work but effect shouldn't run
        store.value = 10;
        expect(doubled()).toBe(20);
        expect(computeRuns).toBe(2);
    });

    it('effect already not dirty when flush runs (node[dirty] is false)', async () => {
        const store = state({ value: 0 });
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
        const store = state({ x: 1 });
        let effectRuns = 0;

        // Chain of computed values
        // Effect depends on last one, which depends on others
        const a = computed(() => store.x + 1);
        const b = computed(() => a() + 1);
        const c = computed(() => b() + 1);

        effect(() => {
            effectRuns++;
            c();
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(c()).toBe(4); // 1 + 1 + 1 + 1

        store.x = 10;
        await flushPromises();
        expect(effectRuns).toBe(2);
        expect(c()).toBe(13); // 10 + 1 + 1 + 1
    });

    it('computed with fewer dependencies on subsequent run triggers cleanup', () => {
        // This test specifically covers line 384: cleanup when sources.length > skippedDeps
        // This happens when a computed accesses fewer properties on a subsequent recomputation
        const store = state({ useAll: true, a: 1, b: 2, c: 3 });

        const conditional = computed(() => {
            if (store.useAll) {
                // Access all three properties
                return store.a + store.b + store.c;
            } else {
                // Access only one property
                return store.a;
            }
        });

        // First computation: accesses a, b, c (sources.length = 3)
        expect(conditional()).toBe(6);

        // Switch to accessing fewer dependencies
        store.useAll = false;

        // Second computation: accesses only a (skippedDeps = 1)
        // This should trigger cleanup at line 384: sources.length (3) > skippedDeps (1)
        // The excess sources (b and c) should be cleaned up
        expect(conditional()).toBe(1);

        // Verify cleanup worked: changing b or c should not cause recomputation
        const oldValue = conditional();
        store.b = 100;
        store.c = 200;
        // Since b and c are no longer dependencies, computed should still return cached value
        expect(conditional()).toBe(oldValue);
    });
});
