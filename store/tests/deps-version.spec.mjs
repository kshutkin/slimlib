import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

/**
 * These tests prove that $_version optimization works correctly for non-live computeds.
 *
 * The $_version is per-deps-set, allowing non-live computeds to skip polling
 * sources that didn't change, even when globalVersion changed due to unrelated changes.
 */
describe('$_version proof', () => {
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

    describe('non-live computed with unrelated signal changes', () => {
        it('should not recompute when only unrelated signal changes', () => {
            // This test proves $_version works:
            // - We have a non-live computed (no effect reading it)
            // - An unrelated signal changes, incrementing globalVersion
            // - The computed should NOT recompute because its source's $_version didn't change

            let computeCount = 0;
            const source = signal(1);
            const unrelated = signal(100);

            const comp = computed(() => {
                computeCount++;
                return source() * 2;
            });

            // First read - computes
            expect(comp()).toBe(2);
            expect(computeCount).toBe(1);

            // Change unrelated signal - this increments globalVersion
            // but NOT the $_version of source's deps set
            unrelated.set(200);
            unrelated.set(300);
            unrelated.set(400);

            // Read computed again - should NOT recompute
            // If $_version wasn't working, this would recompute
            // because globalVersion changed
            expect(comp()).toBe(2);
            expect(computeCount).toBe(1); // Still 1! No recomputation

            // Now change the actual source
            source.set(5);

            // Should recompute now
            expect(comp()).toBe(10);
            expect(computeCount).toBe(2);
        });

        it('should not recompute state-based computed when unrelated state changes', () => {
            let computeCount = 0;
            const store = state({ value: 1 });
            const unrelatedStore = state({ other: 100 });

            const comp = computed(() => {
                computeCount++;
                return store.value * 2;
            });

            // First read
            expect(comp()).toBe(2);
            expect(computeCount).toBe(1);

            // Change unrelated state property many times
            unrelatedStore.other = 200;
            unrelatedStore.other = 300;
            unrelatedStore.other = 400;

            // Read computed - should NOT recompute
            expect(comp()).toBe(2);
            expect(computeCount).toBe(1);

            // Change the actual source
            store.value = 5;

            // Should recompute now
            expect(comp()).toBe(10);
            expect(computeCount).toBe(2);
        });

        it('should handle multiple sources with only one changing', () => {
            let computeCount = 0;
            const a = signal(1);
            const b = signal(10);
            const c = signal(100);

            const comp = computed(() => {
                computeCount++;
                return a() + b() + c();
            });

            // First read
            expect(comp()).toBe(111);
            expect(computeCount).toBe(1);

            // Change only 'b' - this should trigger recomputation
            b.set(20);

            expect(comp()).toBe(121);
            expect(computeCount).toBe(2);

            // Now change an unrelated signal
            const unrelated = signal(999);
            unrelated.set(1000);

            // Read computed - should NOT recompute (none of a, b, c changed)
            expect(comp()).toBe(121);
            expect(computeCount).toBe(2);
        });

        it('should correctly track $_version across multiple reads', () => {
            let computeCount = 0;
            const source = signal(1);
            const unrelated = signal(0);

            const comp = computed(() => {
                computeCount++;
                return source();
            });

            // Initial read
            expect(comp()).toBe(1);
            expect(computeCount).toBe(1);

            // Many unrelated changes followed by reads
            for (let i = 0; i < 10; i++) {
                unrelated.set(i);
                expect(comp()).toBe(1);
            }

            // Should still be only 1 computation
            expect(computeCount).toBe(1);

            // Now actually change source
            source.set(2);
            expect(comp()).toBe(2);
            expect(computeCount).toBe(2);
        });
    });

    describe('$_version with value reversion', () => {
        it('should not recompute when value reverts to original', () => {
            // This proves the second level of optimization:
            // Even when $_version changes, if the value reverted,
            // we still skip recomputation

            let computeCount = 0;
            const source = signal(1);

            const comp = computed(() => {
                computeCount++;
                return source();
            });

            expect(comp()).toBe(1);
            expect(computeCount).toBe(1);

            // Change and revert - $_version will be different,
            // but value check catches the reversion
            source.set(2);
            source.set(1); // revert

            expect(comp()).toBe(1);
            expect(computeCount).toBe(1); // No recomputation due to value revert optimization
        });

        it('should recompute when value actually changes', () => {
            let computeCount = 0;
            const source = signal(1);

            const comp = computed(() => {
                computeCount++;
                return source();
            });

            expect(comp()).toBe(1);
            expect(computeCount).toBe(1);

            // Actually change the value
            source.set(2);

            expect(comp()).toBe(2);
            expect(computeCount).toBe(2);
        });
    });

    describe('live vs non-live behavior', () => {
        it('live computed should update via push, non-live via polling', async () => {
            let liveCount = 0;
            let nonLiveCount = 0;
            const source = signal(1);

            const liveComp = computed(() => {
                liveCount++;
                return source() * 2;
            });

            const nonLiveComp = computed(() => {
                nonLiveCount++;
                return source() * 3;
            });

            // Read both
            expect(liveComp()).toBe(2);
            expect(nonLiveComp()).toBe(3);
            expect(liveCount).toBe(1);
            expect(nonLiveCount).toBe(1);

            // Create effect that makes liveComp "live"
            let effectValue = 0;
            effect(() => {
                effectValue = liveComp();
            });
            await Promise.resolve();
            flushEffects();

            expect(effectValue).toBe(2);
            // Effect read liveComp, but value was cached so no recomputation
            expect(liveCount).toBe(1);
            // nonLiveComp was not read, still 1
            expect(nonLiveCount).toBe(1);

            // Change source
            source.set(5);
            await Promise.resolve();
            flushEffects();

            // Live computed was pushed to and recomputed
            expect(effectValue).toBe(10);
            expect(liveCount).toBe(2);

            // Non-live was not touched
            expect(nonLiveCount).toBe(1);

            // Now read non-live - it should poll and recompute
            expect(nonLiveComp()).toBe(15);
            expect(nonLiveCount).toBe(2);
        });
    });

    describe('edge cases', () => {
        it('should handle computed chain where only leaf changes', () => {
            let aCount = 0, bCount = 0, cCount = 0;
            const source = signal(1);
            const unrelated = signal(100);

            const a = computed(() => { aCount++; return source() + 1; });
            const b = computed(() => { bCount++; return a() + 1; });
            const c = computed(() => { cCount++; return b() + 1; });

            // First read
            expect(c()).toBe(4);
            expect(aCount).toBe(1);
            expect(bCount).toBe(1);
            expect(cCount).toBe(1);

            // Change unrelated signal
            unrelated.set(200);

            // Read c again - no recomputation needed
            expect(c()).toBe(4);
            // All counts should still be 1 because:
            // - c polls b (computed source), sees version unchanged
            // - b polls a (computed source), sees version unchanged
            // - a polls source (state source), sees $_version unchanged
            expect(aCount).toBe(1);
            expect(bCount).toBe(1);
            expect(cCount).toBe(1);

            // Now change the actual source
            source.set(10);

            expect(c()).toBe(13);
            expect(aCount).toBe(2);
            expect(bCount).toBe(2);
            expect(cCount).toBe(2);
        });

        it('should handle multiple state properties independently', () => {
            let xCount = 0, yCount = 0;
            const store = state({ x: 1, y: 10 });

            const compX = computed(() => { xCount++; return store.x * 2; });
            const compY = computed(() => { yCount++; return store.y * 2; });

            // Initial reads
            expect(compX()).toBe(2);
            expect(compY()).toBe(20);
            expect(xCount).toBe(1);
            expect(yCount).toBe(1);

            // Change only x
            store.x = 5;

            // Read both
            expect(compX()).toBe(10);
            expect(compY()).toBe(20);

            // compX recomputed, compY did not (its $_version unchanged)
            expect(xCount).toBe(2);
            expect(yCount).toBe(1);

            // Change only y
            store.y = 50;

            expect(compX()).toBe(10);
            expect(compY()).toBe(100);

            // Now compY recomputed, compX did not
            expect(xCount).toBe(2);
            expect(yCount).toBe(2);
        });
    });

    // Implementation tests, fine to break if implementation changed
    describe('verify $_version is actually incremented', () => {
        it('should increment $_version on deps set when state property changes', () => {
            // This test directly verifies that $_version is being incremented
            // by accessing the internal deps set
            const store = state({ value: 1 });

            // We need to access the internal deps set
            // First, read the property in a computed to create the deps set
            let computeCount = 0;
            const comp = computed(() => {
                computeCount++;
                return store.value;
            });

            // Initial read - creates deps set
            expect(comp()).toBe(1);
            expect(computeCount).toBe(1);

            // Access the internal propertyDepsSymbol to get the deps set
            // We need to use the unwrap symbol to get the raw object
            import('../src/symbols.js').then(({ propertyDepsSymbol, unwrap }) => {
                const rawStore = store[unwrap];
                const propsMap = rawStore[propertyDepsSymbol];
                const deps = propsMap.get('value');

                // Initially $_version should be 0 or undefined (treated as 0)
                const initialVersion = deps.$_version || 0;

                // Change the value
                store.value = 2;

                // $_version should have incremented
                expect(deps.$_version).toBe(initialVersion + 1);

                // Change again
                store.value = 3;
                expect(deps.$_version).toBe(initialVersion + 2);
            });
        });

        it('should NOT increment $_version when unrelated property changes', async () => {
            const { propertyDepsSymbol, unwrap } = await import('../src/symbols.js');

            const store = state({ x: 1, y: 10 });

            // Read both properties in separate computeds
            const compX = computed(() => store.x);
            const compY = computed(() => store.y);

            compX();
            compY();

            // Get the deps sets for each property
            const rawStore = store[unwrap];
            const propsMap = rawStore[propertyDepsSymbol];
            const depsX = propsMap.get('x');
            const depsY = propsMap.get('y');

            const initialXVersion = depsX.$_version || 0;
            const initialYVersion = depsY.$_version || 0;

            // Change only x
            store.x = 5;

            // Only x's depsVersion should increment
            expect(depsX.$_version).toBe(initialXVersion + 1);
            expect(depsY.$_version || 0).toBe(initialYVersion); // y unchanged

            // Change only y
            store.y = 50;

            // Now y increments, x stays the same
            expect(depsX.$_version).toBe(initialXVersion + 1);
            expect(depsY.$_version).toBe(initialYVersion + 1);
        });

        it('should NOT increment $_version when value is same (Object.is)', async () => {
            const { propertyDepsSymbol, unwrap } = await import('../src/symbols.js');

            const store = state({ value: 1 });

            const comp = computed(() => store.value);
            comp();

            const rawStore = store[unwrap];
            const propsMap = rawStore[propertyDepsSymbol];
            const deps = propsMap.get('value');

            const initialVersion = deps.$_version || 0;

            // Set to same value - should NOT trigger markDependents
            store.value = 1;

            // $_version should NOT have changed
            expect(deps.$_version || 0).toBe(initialVersion);

            // Now actually change it
            store.value = 2;
            expect(deps.$_version).toBe(initialVersion + 1);
        });
    });
});
