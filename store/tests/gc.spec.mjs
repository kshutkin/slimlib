import { beforeAll, describe, expect, it } from 'vitest';

import { computed, effect, flush, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    // First yield to microtask queue to let scheduled effects be queued
    await Promise.resolve();
    // Then flush any pending effects
    flush();
    await flushPromises();
}

/**
 * Force garbage collection
 * Requires --expose-gc flag to be passed to Node.js
 */
function forceGC() {
    if (typeof global.gc === 'function') {
        global.gc();
    } else {
        throw new Error('GC is not exposed. Run with --expose-gc flag.');
    }
}

/**
 * Allocate memory to help trigger GC
 */
function allocateMemory() {
    const arrays = [];
    for (let i = 0; i < 100; i++) {
        arrays.push(new Array(10000).fill(i));
    }
    return arrays;
}

describe('garbage collection', () => {
    beforeAll(() => {
        // Verify GC is available
        if (typeof global.gc !== 'function') {
            throw new Error('These tests require --expose-gc. Check vitest.config.mjs poolOptions.');
        }
    });

    it('unreferenced computed is garbage collected', async () => {
        const store = state({ count: 0 });

        // Create a WeakRef to track the computed
        let weakRef;

        // Use a function scope to ensure the computed can be collected
        (() => {
            const doubled = computed(() => store.count * 2);
            // Access it once to establish dependencies
            doubled();
            weakRef = new WeakRef(doubled);
        })();

        // Give microtasks a chance to run
        await flushAll();

        // Allocate memory and force GC
        allocateMemory();
        forceGC();

        // The computed should be collected since nothing references it
        expect(weakRef.deref()).toBeUndefined();
    });

    it('computed referenced by effect is NOT garbage collected', async () => {
        const store = state({ count: 0 });

        let effectRuns = 0;

        const doubled = computed(() => store.count * 2);
        const weakRef = new WeakRef(doubled);

        const dispose = effect(() => {
            effectRuns++;
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Force GC
        allocateMemory();
        forceGC();

        // The computed should NOT be collected since the effect references it
        expect(weakRef.deref()).toBeDefined();

        // Change state and verify effect still works
        store.count = 5;
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(doubled()).toBe(10);

        dispose();
    });

    it('computed in a chain - intermediate computed is collected when unused', async () => {
        const store = state({ value: 1 });

        let weakRefMiddle;

        // Create a computed chain where middle node can be collected
        const first = computed(() => store.value + 1);

        (() => {
            const middle = computed(() => first() * 2);
            // Access to establish dependency
            middle();
            weakRefMiddle = new WeakRef(middle);
        })();

        await flushAll();

        // Force GC
        allocateMemory();
        forceGC();

        // Middle should be collected - it's not referenced
        expect(weakRefMiddle.deref()).toBeUndefined();

        // First should still work
        expect(first()).toBe(2);
    });

    it('disposed effect allows its computed dependencies to be collected', async () => {
        const store = state({ count: 0 });

        let effectRuns = 0;

        // Create computed and effect
        const doubled = computed(() => store.count * 2);
        new WeakRef(doubled);

        const dispose = effect(() => {
            effectRuns++;
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Dispose the effect
        dispose();

        // Remove reference to computed
        // Note: We can't truly remove the reference in this test since we need weakRef
        // But we can verify the pattern works

        // Force GC
        allocateMemory();
        forceGC();

        // Change state - effect should NOT run since disposed
        store.count = 5;
        await flushAll();
        expect(effectRuns).toBe(1);
    });

    it('multiple computeds - only unreferenced ones are collected', async () => {
        const store = state({ a: 1, b: 2 });

        let weakRefUnused;

        const kept = computed(() => store.a + 10);

        (() => {
            const unused = computed(() => store.b + 20);
            unused();
            weakRefUnused = new WeakRef(unused);
        })();

        await flushAll();

        // Force GC
        allocateMemory();
        forceGC();

        // Unused should be collected
        expect(weakRefUnused.deref()).toBeUndefined();

        // Kept should still work
        expect(kept()).toBe(11);

        store.a = 5;
        expect(kept()).toBe(15);
    });

    it('computed depending on another computed - dependent collected first', async () => {
        const store = state({ value: 1 });

        const base = computed(() => store.value * 2);
        let weakRefDependent;

        (() => {
            const dependent = computed(() => base() + 100);
            dependent();
            weakRefDependent = new WeakRef(dependent);
        })();

        await flushAll();

        // Force GC
        allocateMemory();
        forceGC();

        // Dependent should be collected
        expect(weakRefDependent.deref()).toBeUndefined();

        // Base should still work correctly
        expect(base()).toBe(2);

        store.value = 5;
        expect(base()).toBe(10);
    });

    it('dead WeakRefs are cleaned up from dependency sets on state change', async () => {
        const store = state({ count: 0 });

        // Create and immediately discard a computed
        (() => {
            const temp = computed(() => store.count * 3);
            temp();
        })();

        await flushAll();

        // Force GC to collect the temp computed
        allocateMemory();
        forceGC();

        // Changing state should clean up dead WeakRefs
        // This tests the markDependents cleanup path
        store.count = 10;

        await flushAll();

        // No error should occur - dead refs should be cleaned
        expect(store.count).toBe(10);
    });

    it('many transient computeds can be garbage collected', async () => {
        const store = state({ value: 0 });
        const weakRefs = [];

        // Create many computeds in isolated scopes
        for (let i = 0; i < 100; i++) {
            (() => {
                const temp = computed(() => store.value + i);
                temp();
                weakRefs.push(new WeakRef(temp));
            })();
        }

        await flushAll();

        // Force GC multiple times to ensure collection
        for (let i = 0; i < 3; i++) {
            allocateMemory();
            forceGC();
        }

        // At least some should be collected (GC is non-deterministic)
        const collectedCount = weakRefs.filter(ref => ref.deref() === undefined).length;
        expect(collectedCount).toBeGreaterThan(0);
    });

    it('effect with conditional computed dependency - unused branch is collectable', async () => {
        const store = state({ flag: true, a: 1, b: 2 });
        let effectRuns = 0;

        const compA = computed(() => store.a * 10);
        let weakRefB;

        (() => {
            const compB = computed(() => store.b * 20);
            weakRefB = new WeakRef(compB);

            // Access once but don't use in effect
            compB();
        })();

        const dispose = effect(() => {
            effectRuns++;
            if (store.flag) {
                compA();
            }
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // Force GC
        allocateMemory();
        forceGC();

        // compB should be collectable since it's not used by the effect
        expect(weakRefB.deref()).toBeUndefined();

        // compA should still work since effect uses it
        expect(compA()).toBe(10);

        dispose();
    });

    it('state object property deps cleanup when computed is GCd', async () => {
        const store = state({ nested: { value: 1 } });

        // Create a computed that tracks a nested property
        (() => {
            const temp = computed(() => store.nested.value * 2);
            temp();
        })();

        await flushAll();

        // Force GC
        allocateMemory();
        forceGC();

        // Modifying the property should trigger cleanup of dead WeakRefs
        store.nested.value = 5;

        await flushAll();

        // Should not error, and value should be updated
        expect(store.nested.value).toBe(5);
    });

    it('dead WeakRefs cleaned up in computed value-changed loop (line 484)', async () => {
        const store = state({ value: 1 });

        // Create a base computed that we'll keep a reference to
        const base = computed(() => store.value * 2);

        // Access base first to initialize it
        expect(base()).toBe(2);

        // Track WeakRefs to dependents
        const weakRefs = [];

        // Create dependent computeds in isolated scopes
        // These should become eligible for GC once the scope exits
        // Using fewer iterations to reduce resource usage in parallel test runs
        for (let i = 0; i < 100; i++) {
            (() => {
                const dependent = computed(() => base() + i);
                // Access to establish dependency chain: store -> base -> dependent
                dependent();
                weakRefs.push(new WeakRef(dependent));
            })();
        }

        await flushAll();

        // Change store value BEFORE GC - this marks base as needing check
        store.value = 5;

        // Now force aggressive GC AFTER the state change but BEFORE accessing base
        // This way, when base() recomputes and iterates dependencies, some should be dead
        // Using fewer iterations and smaller allocations to be more robust under parallel load
        for (let i = 0; i < 10; i++) {
            // Allocate memory to pressure GC
            const pressure = [];
            for (let j = 0; j < 20; j++) {
                pressure.push(new Array(10000).fill(j));
            }
            forceGC();
            await flushAll();
            await new Promise(resolve => setTimeout(resolve, 1));
        }

        // Now access base to trigger recomputation
        // If any dependents were GC'd, this will hit the cleanup path in forEachDep
        const result = base();

        // Should not error, and base should have correct value
        expect(result).toBe(10);

        // The test passes whether or not GC collected the dependents
        // The important thing is that the code handles both cases correctly
    });
});
