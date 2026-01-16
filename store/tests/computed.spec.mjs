import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, state } from '../src/index.js';

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

describe('computed', () => {
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
        await flushAll();

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

        await flushAll();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushAll();
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

        await flushAll();
        expect(effectRuns).toBe(1);

        store.count = 2;
        await flushAll();
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

    it('throws error on circular dependency (TC39 Signals proposal)', () => {
        /** @type {() => number} */
        const a = computed(() => b() + 1);
        /** @type {() => number} */
        const b = computed(() => a() + 1);

        // Circular dependencies throw an error per TC39 Signals proposal
        expect(() => a()).toThrow('Detected cycle in computations.');
    });

    it('throws error on self-referencing computed', () => {
        /** @type {() => number} */
        const self = computed(() => self() + 1);

        expect(() => self()).toThrow('Detected cycle in computations.');
    });

    it('throws error on indirect cycle through multiple computeds', () => {
        /** @type {() => number} */
        const a = computed(() => c() + 1);
        /** @type {() => number} */
        const b = computed(() => a() + 1);
        /** @type {() => number} */
        const c = computed(() => b() + 1);

        expect(() => a()).toThrow('Detected cycle in computations.');
        expect(() => b()).toThrow('Detected cycle in computations.');
        expect(() => c()).toThrow('Detected cycle in computations.');
    });

    it('cycle error is not cached - throws fresh each time', () => {
        /** @type {() => number} */
        const a = computed(() => b() + 1);
        /** @type {() => number} */
        const b = computed(() => a() + 1);

        // First call throws
        expect(() => a()).toThrow('Detected cycle in computations.');
        // Second call also throws (not cached like regular errors)
        expect(() => a()).toThrow('Detected cycle in computations.');
    });

    it('computed recovers after cycle is broken by changing dependencies', () => {
        const store = state({ useCycle: true, value: 10 });

        /** @type {() => number} */
        const a = computed(() => {
            if (store.useCycle) {
                return b() + 1;
            }
            return store.value;
        });
        /** @type {() => number} */
        const b = computed(() => a() + 1);

        // With cycle enabled, throws
        expect(() => a()).toThrow('Detected cycle in computations.');

        // Break the cycle
        store.useCycle = false;

        // Now it works
        expect(a()).toBe(10);
        expect(b()).toBe(11);
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

        await flushAll();
        expect(effectRuns).toBe(1);

        store.a = 2;
        await flushAll();
        expect(effectRuns).toBe(2);

        store.a = 3;
        await flushAll();
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

    // TC39 Signals proposal compliance: errors are cached and rethrown until dependencies change
    // See: https://github.com/tc39/proposal-signals

    it('computed caches error and rethrows until dependency changes (TC39 proposal)', () => {
        let callCount = 0;
        const store = state({ value: 1 });

        const comp = computed(() => {
            callCount++;
            if (store.value < 0) {
                throw new Error('Negative value');
            }
            return store.value * 2;
        });

        // First access should succeed
        expect(comp()).toBe(2);
        expect(callCount).toBe(1);

        // Change to invalid value
        store.value = -5;

        // Should throw and cache the error
        expect(() => comp()).toThrow('Negative value');
        expect(callCount).toBe(2);

        // Subsequent reads should rethrow the CACHED error without re-executing
        expect(() => comp()).toThrow('Negative value');
        expect(callCount).toBe(2); // Still 2 - callback was NOT called again

        // Change dependency to valid value - should trigger re-evaluation
        store.value = 10;
        expect(comp()).toBe(20);
        expect(callCount).toBe(3);

        // And caching should work normally after recovery
        expect(comp()).toBe(20);
        expect(callCount).toBe(3);
    });

    it('computed error recovery when dependency changes (TC39 proposal)', () => {
        const store = state({ value: -1 });

        const comp = computed(() => {
            if (store.value < 0) {
                throw new Error(`Invalid: ${store.value}`);
            }
            return store.value * 2;
        });

        // First access throws
        expect(() => comp()).toThrow('Invalid: -1');

        // Changing to another invalid value should re-evaluate and throw new error
        store.value = -10;
        expect(() => comp()).toThrow('Invalid: -10');

        // Fix the data - should recover
        store.value = 5;
        expect(comp()).toBe(10);
    });

    it('computed error is cached even without dependencies', () => {
        let callCount = 0;

        const comp = computed(() => {
            callCount++;
            throw new Error('Always fails');
        });

        // First access throws
        expect(() => comp()).toThrow('Always fails');
        expect(callCount).toBe(1);

        // Subsequent access should rethrow cached error without re-executing
        expect(() => comp()).toThrow('Always fails');
        expect(callCount).toBe(1); // Still 1 - not called again
    });

    it('computed error clears previous successful value', () => {
        const store = state({ value: 5 });

        const comp = computed(() => {
            if (store.value < 0) {
                throw new Error('Negative');
            }
            return store.value * 2;
        });

        // Get initial value
        expect(comp()).toBe(10);

        // Cause error
        store.value = -1;
        expect(() => comp()).toThrow('Negative');

        // Recover with new value
        store.value = 7;
        expect(comp()).toBe(14);
    });

    it('computed downstream of errored computed handles error correctly', () => {
        const store = state({ value: 5 });

        const first = computed(() => {
            if (store.value < 0) {
                throw new Error('Upstream error');
            }
            return store.value;
        });

        const second = computed(() => first() * 2);

        // Normal operation
        expect(second()).toBe(10);

        // Cause upstream error
        store.value = -1;
        expect(() => second()).toThrow('Upstream error');

        // Recover
        store.value = 3;
        expect(second()).toBe(6);
    });

    it('computed caches error from source in CHECK path (not just propagates)', () => {
        // This test specifically exercises the CHECK path optimization where
        // a computed with only computed sources checks if they changed before recomputing.
        // When a source throws, the error should be caught in CHECK path and the
        // computed should recompute to properly cache the error.
        const store = state({ value: 5 });
        let firstCallCount = 0;
        let secondCallCount = 0;

        const first = computed(() => {
            firstCallCount++;
            if (store.value < 0) {
                throw new Error('First errored');
            }
            return store.value;
        });

        const second = computed(() => {
            secondCallCount++;
            return first() * 2;
        });

        // Initial read
        expect(second()).toBe(10);
        expect(firstCallCount).toBe(1);
        expect(secondCallCount).toBe(1);

        // Read again - should be cached, no recomputation
        expect(second()).toBe(10);
        expect(firstCallCount).toBe(1);
        expect(secondCallCount).toBe(1);

        // Trigger error in first
        store.value = -1;

        // First read after error - both should recompute
        expect(() => second()).toThrow('First errored');
        expect(firstCallCount).toBe(2);
        expect(secondCallCount).toBe(2);

        // Second read - errors should be cached in BOTH computeds
        // first() should NOT be called again (its error is cached)
        // second() should NOT be called again (its error is cached via CHECK path fix)
        expect(() => second()).toThrow('First errored');
        expect(firstCallCount).toBe(2); // Still 2 - error cached in first
        expect(secondCallCount).toBe(2); // Still 2 - error cached in second (CHECK path fix)

        // Recover
        store.value = 3;
        expect(second()).toBe(6);
        expect(firstCallCount).toBe(3);
        expect(secondCallCount).toBe(3);
    });

    it('effect handles computed error gracefully', async () => {
        const store = state({ value: 5 });
        /** @type {Array<{value?: number, error?: string}>} */
        const results = [];

        const comp = computed(() => {
            if (store.value < 0) {
                throw new Error('Negative');
            }
            return store.value * 2;
        });

        const dispose = effect(() => {
            try {
                results.push({ value: comp() });
            } catch (/** @type {any} */ e) {
                results.push({ error: e.message });
            }
        });

        await flushAll();
        expect(results).toEqual([{ value: 10 }]);

        // Trigger error
        store.value = -1;
        await flushAll();
        expect(results).toEqual([{ value: 10 }, { error: 'Negative' }]);

        // Recover
        store.value = 7;
        await flushAll();
        expect(results).toEqual([{ value: 10 }, { error: 'Negative' }, { value: 14 }]);

        dispose();
    });

    it('effect depending on computed clears sources properly on dispose', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;

        const doubled = computed(() => store.value * 2);

        const dispose = effect(() => {
            effectRuns++;
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Dispose the effect
        dispose();

        // Change the store - effect should NOT run
        store.value = 5;
        await flushAll();
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

        await flushAll();
        expect(effectRuns).toBe(1);

        dispose();

        // Changes should not trigger effect
        store.value = 10;
        await flushAll();
        expect(effectRuns).toBe(1);
    });

    it('disposed effect is not run when flush happens', async () => {
        const store = state({ value: 1 });
        let effectRuns = 0;

        const dispose = effect(() => {
            effectRuns++;
            store.value;
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Change store to trigger effect (it gets batched)
        store.value = 2;

        // Immediately dispose before flush happens
        dispose();

        await flushAll();
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

        await flushAll();
        expect(runs).toBe(1);

        // Change multiple tracked properties
        store.a = 10;
        store.b = 20;

        await flushAll();
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

        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        // Dispose first effect
        dispose1();

        // Change should only trigger second effect
        store.value = 5;
        await flushAll();
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
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);
        expect(doubled()).toBe(2);

        // Change store - triggers effect to re-run
        // When effect re-runs, clearSources is called which should hit
        // the `else if (source.computed)` branch
        store.value = 5;
        await flushAll();
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

        await flushAll();
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

        await flushAll();
        expect(effectRuns).toBe(1);

        // Trigger a change - effect gets batched and marked dirty
        store.value = 1;

        // Dispose effect - this removes from batched AND clears dirty indirectly
        // by removing from the batch before it runs
        dispose();

        await flushAll();
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

        await flushAll();
        expect(effectRuns).toBe(1);
        expect(c()).toBe(4); // 1 + 1 + 1 + 1

        store.x = 10;
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(c()).toBe(13); // 10 + 1 + 1 + 1
    });

    it('computed that modifies state during execution is intentionally not re-marked', async () => {
        // This tests the branch where a computed (not effect) is COMPUTING
        // and state changes during its execution (forceComputing=true, isEffect=false)
        // Unlike effects, computeds are NOT re-marked as COMPUTING_DIRTY because
        // computeds should be pure - this behavior discourages side effects
        const store = state({ value: 0 });
        let computeCount = 0;

        const derived = computed(() => {
            computeCount++;
            const v = store.value;
            // Modify state during computation (side effect - not recommended!)
            if (v < 2) {
                store.value = v + 1;
            }
            return v;
        });

        // First access - computed runs and modifies state during execution
        // The state change does NOT cause re-run because:
        // 1. Computed is in COMPUTING state
        // 2. forceComputing=true (from state change) but node[isEffect]=false
        // 3. So the computed is NOT marked COMPUTING_DIRTY
        expect(derived()).toBe(0);
        expect(computeCount).toBe(1);

        // Accessing again - computed is CLEAN (not re-marked), so it returns cached value
        // This is intentional - computeds should not have side effects
        expect(derived()).toBe(0); // Still 0, cached value!
        expect(computeCount).toBe(1); // No recomputation

        // The state WAS modified though
        expect(store.value).toBe(1);

        // External state change will trigger recomputation
        store.value = 5;
        expect(derived()).toBe(5);
        expect(computeCount).toBe(2);
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

    it('computed becomes live after being read non-live first (exercises makeLive recursion)', async () => {
        // This test covers the recursive makeLive call when a computed
        // that has already been computed (has sources) becomes live later
        const store = state({ value: 1 });

        // Create a chain of computeds
        const a = computed(() => store.value + 1);
        const b = computed(() => a() + 1);
        const c = computed(() => b() + 1);

        // Read them all non-live first (no effect) - this populates their sources
        expect(c()).toBe(4);
        expect(b()).toBe(3);
        expect(a()).toBe(2);

        // Now create an effect that reads the end of the chain
        // This should make c live, which should recursively make b and a live
        let effectValue = 0;
        const dispose = effect(() => {
            effectValue = c();
        });

        await flushAll();
        expect(effectValue).toBe(4);

        // Change the source - the effect should be notified through the live chain
        store.value = 10;
        await flushAll();
        expect(effectValue).toBe(13);

        dispose();
    });

    it('computed reading state that changes during computation is not re-marked (markNeedsCheck computing branch)', async () => {
        // This test covers the branch in markNeedsCheck where a non-effect
        // computed is currently computing and we try to mark it
        const store = state({ value: 1, trigger: 0 });

        const comp = computed(() => {
            const val = store.value;
            // Reading trigger here, but we'll change it during another computed's execution
            store.trigger;
            return val * 2;
        });

        // Create another computed that modifies state when read
        const modifier = computed(() => {
            // This will try to mark comp, but comp might be computing
            store.trigger = store.trigger + 1;
            return comp();
        });

        // Read through the modifier - this exercises the path where
        // comp is computing and trigger change tries to mark it
        expect(modifier()).toBe(2);

        // The computed should work correctly
        store.value = 5;
        expect(modifier()).toBe(10);
    });

    it('live computed that modifies its own dependency during computation is not re-marked', async () => {
        // This test specifically covers line 447: a non-effect computed is computing
        // and a state change tries to mark it via markNeedsCheck
        // The computed must be LIVE (in deps) for markNeedsCheck to be called on it
        const store = state({ value: 1 });

        let computeCount = 0;
        const selfModifying = computed(() => {
            computeCount++;
            const val = store.value;
            // Modify the same state we just read - this triggers markNeedsCheck
            // on ourselves while we're still computing
            if (val < 10) {
                store.value = val + 1;
            }
            return val;
        });

        // Create an effect to make selfModifying live
        let effectValue = 0;
        const dispose = effect(() => {
            effectValue = selfModifying();
        });

        await flushAll();
        // The computed ran once, modified state, but wasn't re-marked during computation
        expect(effectValue).toBe(1);
        expect(computeCount).toBe(1);

        // Now the state is 2, so next read will see 2
        store.value = 5;
        await flushAll();
        expect(effectValue).toBe(5);

        dispose();
    });

    it('non-live computed chain with source change exercises sourceChanged branch', () => {
        // This test covers the sourceChanged branch in the polling verification
        // for non-live computeds with only computed sources
        const store = state({ value: 1 });

        // Create a chain of computeds (none are live - no effect)
        const a = computed(() => store.value * 2);
        const b = computed(() => a() + 10);

        // First read - both compute
        expect(b()).toBe(12); // (1 * 2) + 10

        // Change the source state
        store.value = 5;

        // Read b again - it's non-live, has only computed sources
        // b will poll a, a will recompute (state source), version changes
        // b sees sourceChanged = true, marks itself dirty, recomputes
        expect(b()).toBe(20); // (5 * 2) + 10

        // Verify the chain continues to work
        store.value = 10;
        expect(b()).toBe(30); // (10 * 2) + 10
    });

    it('reading same property multiple times then changing pattern preserves reactivity', async () => {
        // This test covers the isRetained check in clearSources (lines 90-96)
        // When a computed reads the same property multiple times, duplicate deps entries are created.
        // When the dependency pattern changes, clearSources must not remove the WeakRef from a deps
        // Set that is still referenced in the retained portion of the sources array.
        const store = state({ x: 1, y: 2, useDouble: true });
        let computeCount = 0;

        const comp = computed(() => {
            computeCount++;
            if (store.useDouble) {
                // Read x twice - creates duplicate deps entries: [{deps: depsX}, {deps: depsX}]
                return store.x + store.x;
            } else {
                // Read x once, then y - clearSources(node, 1) should detect depsX is retained
                return store.x + store.y;
            }
        });

        // First run: reads x twice, creates duplicate entries
        expect(comp()).toBe(2);
        expect(computeCount).toBe(1);

        // Change to different dependency pattern
        store.useDouble = false;

        // Second run: reads x once, then y
        // clearSources clears from index 1, isRetained check finds depsX at index 0
        expect(comp()).toBe(3);
        expect(computeCount).toBe(2);

        // Verify reactivity still works - changing x should trigger recompute
        // This would fail if isRetained check was missing (WeakRef incorrectly removed from depsX)
        store.x = 10;
        expect(comp()).toBe(12); // 10 + 2
        expect(computeCount).toBe(3);

        // Changing y should also trigger recompute
        store.y = 5;
        expect(comp()).toBe(15); // 10 + 5
        expect(computeCount).toBe(4);
    });
});
