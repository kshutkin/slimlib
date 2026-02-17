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

describe('computed optimization', () => {
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

    describe('value revert optimization', () => {
        it('should not update if the signal value is reverted before read', () => {
            let times = 0;

            const s = signal(0);
            const c1 = computed(() => {
                times++;
                return s();
            });

            c1();
            expect(times).toBe(1);

            s.set(1);
            s.set(0); // Revert back to original

            c1();
            expect(times).toBe(1); // Should not recompute - value unchanged
        });

        it('should not update if state value is reverted before read', () => {
            let times = 0;

            const store = state({ value: 0 });
            const c1 = computed(() => {
                times++;
                return store.value;
            });

            c1();
            expect(times).toBe(1);

            store.value = 1;
            store.value = 0; // Revert back to original

            c1();
            expect(times).toBe(1);
        });

        it('should update when value changes even if it was reverted earlier', () => {
            let times = 0;

            const s = signal(0);
            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(0);
            expect(times).toBe(1);

            // Revert scenario
            s.set(1);
            s.set(0);
            expect(comp()).toBe(0);
            expect(times).toBe(1);

            // Now actually change
            s.set(5);
            expect(comp()).toBe(5);
            expect(times).toBe(2);
        });

        it('should handle multiple reverts in sequence', () => {
            let times = 0;

            const s = signal('initial');
            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe('initial');
            expect(times).toBe(1);

            // Multiple changes that revert
            s.set('a');
            s.set('b');
            s.set('c');
            s.set('initial'); // Back to original

            expect(comp()).toBe('initial');
            expect(times).toBe(1);
        });
    });

    describe('bail-out optimization', () => {
        it('should bail out if computed returns same value', () => {
            const store = state({ a: 'a' });
            let bTimes = 0;
            let cTimes = 0;

            const b = computed(() => {
                bTimes++;
                store.a; // Read but ignore
                return 'constant';
            });

            const c = computed(() => {
                cTimes++;
                return b();
            });

            expect(c()).toBe('constant');
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.a = 'changed';

            expect(c()).toBe('constant');
            expect(bTimes).toBe(2); // b recomputes
            expect(cTimes).toBe(1); // c does not - b returned same value
        });

        it('should propagate change when computed value actually changes', () => {
            const store = state({ value: 1 });
            let bTimes = 0;
            let cTimes = 0;

            const b = computed(() => {
                bTimes++;
                return store.value;
            });

            const c = computed(() => {
                cTimes++;
                return b() * 2;
            });

            expect(c()).toBe(2);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.value = 5;

            expect(c()).toBe(10);
            expect(bTimes).toBe(2);
            expect(cTimes).toBe(2);
        });

        it('should handle bail-out in diamond pattern', () => {
            //     A
            //   /   \
            // *B     C (B returns constant)
            //   \   /
            //     D
            const store = state({ a: 1 });
            let dTimes = 0;

            const b = computed(() => {
                store.a; // Read but return constant
                return 100;
            });

            const c = computed(() => store.a * 2);

            const d = computed(() => {
                dTimes++;
                return b() + c();
            });

            expect(d()).toBe(102); // 100 + 2
            expect(dTimes).toBe(1);

            store.a = 5;

            expect(d()).toBe(110); // 100 + 10
            expect(dTimes).toBe(2); // D must recompute because C changed
        });

        it('should not propagate when all sources bail out', () => {
            const store = state({ value: 1 });
            let cTimes = 0;

            const a = computed(() => {
                store.value;
                return 'constant-a';
            });

            const b = computed(() => {
                store.value;
                return 'constant-b';
            });

            const c = computed(() => {
                cTimes++;
                return a() + b();
            });

            expect(c()).toBe('constant-aconstant-b');
            expect(cTimes).toBe(1);

            store.value = 100;

            expect(c()).toBe('constant-aconstant-b');
            expect(cTimes).toBe(1); // Should not recompute
        });
    });

    describe('effect optimization with computed', () => {
        it('should not run effect when computed bails out', async () => {
            const store = state({ trigger: 0 });
            let effectRuns = 0;

            const alwaysSame = computed(() => {
                store.trigger; // Read
                return 'always same';
            });

            effect(() => {
                effectRuns++;
                alwaysSame();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.trigger = 1;
            await flushAll();
            expect(effectRuns).toBe(1); // Should not re-run
        });

        it('should run effect when computed actually changes', async () => {
            const store = state({ value: 1 });
            let effectRuns = 0;

            const doubled = computed(() => store.value * 2);

            effect(() => {
                effectRuns++;
                doubled();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.value = 5;
            await flushAll();
            expect(effectRuns).toBe(2);
        });

        it('should optimize when signal reverts before effect runs', async () => {
            const s = signal(0);
            let effectRuns = 0;
            let lastSeen = -1;

            effect(() => {
                effectRuns++;
                lastSeen = s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);
            expect(lastSeen).toBe(0);

            // Change and revert before flush
            s.set(100);
            s.set(0);

            await flushAll();
            // Effect might still run because it was marked dirty,
            // but it should see the final value
            expect(lastSeen).toBe(0);
        });
    });

    describe('computed chain optimization', () => {
        it('should optimize long chain when first computed bails out', () => {
            const store = state({ ignored: 0 });
            let aTimes = 0,
                bTimes = 0,
                cTimes = 0,
                dTimes = 0;

            const a = computed(() => {
                aTimes++;
                store.ignored;
                return 'constant';
            });

            const b = computed(() => {
                bTimes++;
                return `${a()}-b`;
            });

            const c = computed(() => {
                cTimes++;
                return `${b()}-c`;
            });

            const d = computed(() => {
                dTimes++;
                return `${c()}-d`;
            });

            expect(d()).toBe('constant-b-c-d');
            expect(aTimes).toBe(1);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);
            expect(dTimes).toBe(1);

            store.ignored = 999;

            expect(d()).toBe('constant-b-c-d');
            expect(aTimes).toBe(2); // a recomputes
            expect(bTimes).toBe(1); // Rest don't because a bailed out
            expect(cTimes).toBe(1);
            expect(dTimes).toBe(1);
        });

        it('should propagate change through chain when value changes', () => {
            const store = state({ value: 1 });
            let aTimes = 0,
                bTimes = 0,
                cTimes = 0;

            const a = computed(() => {
                aTimes++;
                return store.value;
            });

            const b = computed(() => {
                bTimes++;
                return a() * 2;
            });

            const c = computed(() => {
                cTimes++;
                return b() + 1;
            });

            expect(c()).toBe(3);
            expect(aTimes).toBe(1);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.value = 5;

            expect(c()).toBe(11);
            expect(aTimes).toBe(2);
            expect(bTimes).toBe(2);
            expect(cTimes).toBe(2);
        });
    });

    describe('conditional dependency optimization', () => {
        it('should not recompute when unused branch changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            expect(times).toBe(1);

            // Change unused branch
            store.b = 100;

            expect(result()).toBe(1);
            expect(times).toBe(1); // Should not recompute
        });

        it('should recompute when active branch changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            expect(times).toBe(1);

            store.a = 10;

            expect(result()).toBe(10);
            expect(times).toBe(2);
        });

        it('should update dependencies when condition changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            times = 0;

            // Switch to b branch
            store.flag = false;
            expect(result()).toBe(2);
            expect(times).toBe(1);

            // Now a changes should not trigger
            times = 0;
            store.a = 100;
            expect(result()).toBe(2);
            expect(times).toBe(0);

            // But b changes should
            store.b = 200;
            expect(result()).toBe(200);
            expect(times).toBe(1);
        });
    });

    describe('object equality optimization', () => {
        it('should use Object.is for value comparison', () => {
            const s = signal(NaN);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBeNaN();
            expect(times).toBe(1);

            s.set(NaN); // NaN === NaN with Object.is

            expect(comp()).toBeNaN();
            expect(times).toBe(1); // Should not recompute
        });

        it('should distinguish +0 and -0', () => {
            const s = signal(+0);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(0);
            expect(times).toBe(1);

            s.set(-0); // -0 !== +0 with Object.is

            expect(comp()).toBe(-0);
            expect(times).toBe(2);
        });

        it('should not recompute for same object reference', () => {
            const obj = { value: 1 };
            const s = signal(obj);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(obj);
            expect(times).toBe(1);

            // Mutate and set same reference
            obj.value = 999;
            s.set(obj);

            expect(comp().value).toBe(999);
            expect(times).toBe(1); // Same reference, no recompute
        });

        it('should recompute for different object reference with same content', () => {
            const s = signal({ value: 1 });
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp().value).toBe(1);
            expect(times).toBe(1);

            s.set({ value: 1 }); // Different reference

            expect(comp().value).toBe(1);
            expect(times).toBe(2);
        });
    });

    describe('cached error with unchanged sources', () => {
        it('should return cached error when computed sources unchanged (non-live)', async () => {
            const trigger = signal(0);
            const unrelated = signal(100);
            let sourceCallCount = 0;
            let errorCallCount = 0;

            const source = computed(() => {
                sourceCallCount++;
                return trigger();
            });

            const errorComp = computed(() => {
                errorCallCount++;
                if (source() < 0) {
                    throw new Error('Negative value');
                }
                return source() * 2;
            });

            // Create an effect that reads unrelated to make it increment globalVersion when changed
            effect(() => {
                unrelated();
            });
            await flushAll();

            // Initial read
            expect(errorComp()).toBe(0);
            expect(errorCallCount).toBe(1);
            expect(sourceCallCount).toBe(1);

            // Trigger error
            trigger.set(-1);
            expect(() => errorComp()).toThrow('Negative value');
            expect(errorCallCount).toBe(2);
            expect(sourceCallCount).toBe(2);

            // Change unrelated signal (increments globalVersion because effect reads it)
            unrelated.set(200);
            await flushAll();

            // Read again - source hasn't changed, should return cached error
            expect(() => errorComp()).toThrow('Negative value');
            // source should not recompute (its dep didn't change)
            expect(sourceCallCount).toBe(2);
            // errorComp should not recompute either (source version unchanged)
            expect(errorCallCount).toBe(2);
        });

        it('should return cached error when state sources unchanged (non-live)', async () => {
            const store = state({ value: 5 });
            const unrelated = signal(100);
            let callCount = 0;

            const errorComp = computed(() => {
                callCount++;
                if (store.value < 0) {
                    throw new Error('Negative value');
                }
                return store.value * 2;
            });

            // Create an effect that reads unrelated to make it increment globalVersion when changed
            effect(() => {
                unrelated();
            });
            await flushAll();

            // Initial read
            expect(errorComp()).toBe(10);
            expect(callCount).toBe(1);

            // Trigger error
            store.value = -1;
            expect(() => errorComp()).toThrow('Negative value');
            expect(callCount).toBe(2);

            // Change unrelated signal (increments globalVersion because effect reads it)
            unrelated.set(200);
            await flushAll();

            // Read again - store.value hasn't changed, should return cached error
            expect(() => errorComp()).toThrow('Negative value');
            expect(callCount).toBe(2); // Should not recompute
        });
    });

    describe('mixed dependencies (state and computed sources)', () => {
        it('should handle non-live computed with both signal and computed sources', async () => {
            const sig = signal(1);
            const unrelated = signal(100);
            let compCallCount = 0;
            let mixedCallCount = 0;

            const comp = computed(() => {
                compCallCount++;
                return sig() * 2;
            });

            // This computed depends on BOTH a signal (state source) and a computed
            const mixed = computed(() => {
                mixedCallCount++;
                return sig() + comp();
            });

            // Create an effect that reads unrelated to make it increment globalVersion when changed
            effect(() => {
                unrelated();
            });
            await flushAll();

            // Initial read
            expect(mixed()).toBe(3); // 1 + 2
            expect(mixedCallCount).toBe(1);
            expect(compCallCount).toBe(1);

            // Change unrelated signal (only globalVersion changes, not sig)
            unrelated.set(200);
            await flushAll();

            // Read again - neither sig nor comp changed, should return cached
            expect(mixed()).toBe(3);
            expect(mixedCallCount).toBe(1); // Should not recompute
            expect(compCallCount).toBe(1); // Should not recompute

            // Now change sig - both should recompute
            sig.set(5);
            expect(mixed()).toBe(15); // 5 + 10
            expect(mixedCallCount).toBe(2);
            expect(compCallCount).toBe(2);
        });

        it('should recompute when computed source changes but state source unchanged', async () => {
            const stateSig = signal(10);
            const compTrigger = signal(1);
            const unrelated = signal(100);
            let compCallCount = 0;
            let mixedCallCount = 0;

            const comp = computed(() => {
                compCallCount++;
                return compTrigger() * 2;
            });

            // Mixed depends on both stateSig and comp
            const mixed = computed(() => {
                mixedCallCount++;
                return stateSig() + comp();
            });

            effect(() => {
                unrelated();
            });
            await flushAll();

            // Initial read
            expect(mixed()).toBe(12); // 10 + 2
            expect(mixedCallCount).toBe(1);

            // Change only compTrigger (affects comp but not stateSig)
            compTrigger.set(5);
            expect(mixed()).toBe(20); // 10 + 10
            expect(mixedCallCount).toBe(2);
            expect(compCallCount).toBe(2);
        });
    });

    describe('live computed CHECK with unchanged sources', () => {
        it('should return cached value when live computed sources produce same value', async () => {
            const trigger = signal(1);
            let sourceCallCount = 0;
            let derivedCallCount = 0;
            let effectCallCount = 0;

            // Source computed returns 'positive' for any positive number
            const source = computed(() => {
                sourceCallCount++;
                return trigger() > 0 ? 'positive' : 'negative';
            });

            // Derived computed depends on source
            const derived = computed(() => {
                derivedCallCount++;
                return `${source()}!`;
            });

            // Effect makes both computeds live
            effect(() => {
                effectCallCount++;
                derived();
            });

            await flushAll();
            expect(effectCallCount).toBe(1);
            expect(sourceCallCount).toBe(1);
            expect(derivedCallCount).toBe(1);

            // Change trigger to different positive value - source will produce same result
            trigger.set(2);

            await flushAll();
            // Effect doesn't re-run because derived returns cached value (source value unchanged)
            expect(effectCallCount).toBe(1);
            expect(sourceCallCount).toBe(2); // Source recomputed
            expect(derivedCallCount).toBe(1); // Derived should NOT recompute (source value unchanged)
        });

        it('should return cached value for live computed chain with equality cutoff', async () => {
            const count = signal(5);
            let classifyCallCount = 0;
            let displayCallCount = 0;

            // Classify returns 'high' for >= 5, 'low' for < 5
            const classify = computed(() => {
                classifyCallCount++;
                return count() >= 5 ? 'high' : 'low';
            });

            // Display depends on classification
            const display = computed(() => {
                displayCallCount++;
                return `Status: ${classify()}`;
            });

            // Make live
            effect(() => {
                display();
            });

            await flushAll();
            expect(classifyCallCount).toBe(1);
            expect(displayCallCount).toBe(1);

            // Change from 5 to 10 - still 'high'
            count.set(10);
            await flushAll();
            expect(classifyCallCount).toBe(2);
            expect(displayCallCount).toBe(1); // Should not recompute

            // Change from 10 to 100 - still 'high'
            count.set(100);
            await flushAll();
            expect(classifyCallCount).toBe(3);
            expect(displayCallCount).toBe(1); // Still should not recompute

            // Now change to 'low'
            count.set(3);
            await flushAll();
            expect(classifyCallCount).toBe(4);
            expect(displayCallCount).toBe(2); // Now it should recompute
        });

        it('should return cached error for live computed when sources unchanged', async () => {
            const trigger = signal(1);
            let sourceCallCount = 0;
            let errorCallCount = 0;

            // Source computed returns 'positive' for any positive number
            const source = computed(() => {
                sourceCallCount++;
                return trigger() > 0 ? 'positive' : 'negative';
            });

            // Error computed depends on source - throws when negative
            const errorComp = computed(() => {
                errorCallCount++;
                const val = source();
                if (val === 'negative') {
                    throw new Error('Negative not allowed');
                }
                return `${val}!`;
            });

            // Effect makes both computeds live
            effect(() => {
                try {
                    errorComp();
                } catch {
                    // Swallow error in effect
                }
            });

            await flushAll();
            expect(sourceCallCount).toBe(1);
            expect(errorCallCount).toBe(1);

            // Trigger error
            trigger.set(-1);
            await flushAll();
            expect(sourceCallCount).toBe(2);
            expect(errorCallCount).toBe(2);
            expect(() => errorComp()).toThrow('Negative not allowed');

            // Now change trigger to different negative value - source will produce same result
            trigger.set(-5);
            await flushAll();
            expect(sourceCallCount).toBe(3); // Source recomputed
            // errorComp should not recompute because source value ('negative') unchanged
            // and should throw cached error
            expect(errorCallCount).toBe(2);
            expect(() => errorComp()).toThrow('Negative not allowed');
        });
    });

    describe('live computed with unrelated source change', () => {
        it('should return cached value when unrelated source changes (covers line 67 else branch)', async () => {
            // Create two independent state sources
            const store1 = state({ value: 1 });
            const store2 = state({ value: 100 });

            let comp1Count = 0;
            let comp2Count = 0;

            // Computed depends only on store1
            const comp1 = computed(() => {
                comp1Count++;
                return store1.value * 2;
            });

            // Computed depends only on store2 - needed to give store2 dependents
            // so that changing store2 increments globalVersion
            const comp2 = computed(() => {
                comp2Count++;
                return store2.value * 2;
            });

            let effect1Value = null;
            let effect2Value = null;

            // Effect makes comp1 live
            effect(() => {
                effect1Value = comp1();
            });

            // Effect makes comp2 live (gives store2 dependents so globalVersion increments)
            effect(() => {
                effect2Value = comp2();
            });

            await flushAll();
            expect(comp1Count).toBe(1);
            expect(comp2Count).toBe(1);
            expect(effect1Value).toBe(2);
            expect(effect2Value).toBe(200);

            // Change unrelated store2 - this increments globalVersion
            // but doesn't notify comp1 (it doesn't depend on store2)
            store2.value = 200;
            await flushAll();

            // comp2 recomputed because its source changed
            expect(comp2Count).toBe(2);
            // comp1 should NOT have recomputed - its source didn't change
            expect(comp1Count).toBe(1);

            // Reading comp1 should return cached value
            // This exercises the path where:
            // - comp1 is live (FLAG_IS_LIVE)
            // - comp1 has no FLAG_NEEDS_WORK (unrelated source changed)
            // - globalVersion changed (from store2 change)
            // - comp1 should return cached value without recomputing
            const result = comp1();
            expect(result).toBe(2);
            expect(comp1Count).toBe(1); // Should not have recomputed
        });
    });

    describe('computed same value after state change', () => {
        it('should set FLAG_HAS_VALUE when dirty but value unchanged (covers line 155 wasDirty branch)', () => {
            // Non-live computed that will be marked DIRTY but return same value
            const store = state({ value: 1 });

            let computeCount = 0;

            // Computed returns value mod 2 - so values 1 and 3 both return 1
            const comp = computed(() => {
                computeCount++;
                return store.value % 2;
            });

            // First read - computes and caches value 1
            expect(comp()).toBe(1);
            expect(computeCount).toBe(1);

            // Change state to a different value that produces the same result
            // This will mark the computed as DIRTY (not just CHECK) because:
            // - It's non-live (no effect)
            // - State source changed (depsVersion mismatch)
            // - Value 3 !== stored value 1 (can't use reversion optimization)
            store.value = 3;

            // Second read - should recompute but get same value
            // This exercises the path where:
            // - wasDirty is true (FLAG_DIRTY was set during polling)
            // - changed is false (new value 1 equals old value 1)
            // - enters `else if (wasDirty)` branch
            expect(comp()).toBe(1);
            expect(computeCount).toBe(2); // Did recompute

            // Third read should use cache
            expect(comp()).toBe(1);
            expect(computeCount).toBe(2); // No additional recompute
        });

        it('should handle multiple consecutive same-value changes', () => {
            const store = state({ a: 1, b: 1 });

            let computeCount = 0;

            // Computed returns sum - different a/b pairs can produce same sum
            const sum = computed(() => {
                computeCount++;
                return store.a + store.b;
            });

            expect(sum()).toBe(2);
            expect(computeCount).toBe(1);

            // Change both values but keep sum the same
            store.a = 0;
            store.b = 2;

            expect(sum()).toBe(2);
            expect(computeCount).toBe(2); // Recomputed but same value

            // Change again, still same sum
            store.a = 2;
            store.b = 0;

            expect(sum()).toBe(2);
            expect(computeCount).toBe(3); // Recomputed but same value

            // Verify caching works after same-value recomputes
            expect(sum()).toBe(2);
            expect(computeCount).toBe(3); // No recompute
        });
    });
});
