import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

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

    describe('execution order', () => {
        it('effects execute in creation order on initial run', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const store = state({ value: 0 });

            effect(() => {
                store.value;
                executionOrder.push(0);
            });
            effect(() => {
                store.value;
                executionOrder.push(1);
            });
            effect(() => {
                store.value;
                executionOrder.push(2);
            });

            await flushAll();
            expect(executionOrder).toEqual([0, 1, 2]);
        });

        it('effects execute in creation order on re-run', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const store = state({ value: 0 });

            effect(() => {
                store.value;
                executionOrder.push(0);
            });
            effect(() => {
                store.value;
                executionOrder.push(1);
            });
            effect(() => {
                store.value;
                executionOrder.push(2);
            });

            await flushAll();
            executionOrder.length = 0;

            store.value = 1;
            await flushAll();
            expect(executionOrder).toEqual([0, 1, 2]);
        });

        it('effects on different signals execute in creation order', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const storeA = state({ value: 0 });
            const storeB = state({ value: 0 });

            // Interleaved: 0->A, 1->B, 2->A, 3->B, 4->A
            effect(() => {
                storeA.value;
                executionOrder.push(0);
            });
            effect(() => {
                storeB.value;
                executionOrder.push(1);
            });
            effect(() => {
                storeA.value;
                executionOrder.push(2);
            });
            effect(() => {
                storeB.value;
                executionOrder.push(3);
            });
            effect(() => {
                storeA.value;
                executionOrder.push(4);
            });

            await flushAll();
            executionOrder.length = 0;

            // Change only storeA - should trigger 0, 2, 4 in creation order
            storeA.value = 1;
            await flushAll();
            expect(executionOrder).toEqual([0, 2, 4]);

            executionOrder.length = 0;

            // Change only storeB - should trigger 1, 3 in creation order
            storeB.value = 1;
            await flushAll();
            expect(executionOrder).toEqual([1, 3]);
        });

        it('effects with diamond dependency execute in creation order', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const store = state({ value: 0 });

            const compA = computed(() => store.value * 2);
            const compB = computed(() => store.value * 3);

            // Effect 0 depends on compA
            effect(() => {
                compA();
                executionOrder.push(0);
            });
            // Effect 1 depends on compB
            effect(() => {
                compB();
                executionOrder.push(1);
            });
            // Effect 2 depends on both
            effect(() => {
                compA();
                compB();
                executionOrder.push(2);
            });
            // Effect 3 depends on compA
            effect(() => {
                compA();
                executionOrder.push(3);
            });

            await flushAll();
            executionOrder.length = 0;

            store.value = 1;
            await flushAll();
            expect(executionOrder).toEqual([0, 1, 2, 3]);
        });

        it('effects with dynamic dependencies maintain creation order', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const control = state({ useA: true });
            const storeA = state({ value: 1 });
            const storeB = state({ value: 100 });

            // Effect 0: always reads control
            effect(() => {
                control.useA;
                executionOrder.push(0);
            });

            // Effect 1: reads A or B based on control
            effect(() => {
                if (control.useA) {
                    storeA.value;
                } else {
                    storeB.value;
                }
                executionOrder.push(1);
            });

            // Effect 2: always reads storeA
            effect(() => {
                storeA.value;
                executionOrder.push(2);
            });

            // Effect 3: always reads storeB
            effect(() => {
                storeB.value;
                executionOrder.push(3);
            });

            await flushAll();
            executionOrder.length = 0;

            // Change storeA - should trigger effects 1 and 2
            storeA.value = 2;
            await flushAll();
            expect(executionOrder).toEqual([1, 2]);

            executionOrder.length = 0;

            // Flip control - effect 1 now subscribes to B instead of A
            control.useA = false;
            await flushAll();
            executionOrder.length = 0;

            // Change storeA - should only trigger effect 2 now
            storeA.value = 3;
            await flushAll();
            expect(executionOrder).toEqual([2]);

            executionOrder.length = 0;

            // Change storeB - should trigger effects 1 and 3 in creation order
            storeB.value = 200;
            await flushAll();
            expect(executionOrder).toEqual([1, 3]);
        });

        it('newly created effect during batch updates lastAddedId for correct ordering', async () => {
            // This test catches a bug where effect creation uses batched.add() directly
            // without updating lastAddedId, which can cause incorrect execution order
            /** @type {string[]} */
            const executionOrder = [];
            const signalA = signal(0);
            const signalB = signal(0);

            // Create effect A (id=N) - depends on signalA
            effect(() => {
                signalA();
                executionOrder.push('A');
            });

            // Create effect B (id=N+1) - depends on signalB
            effect(() => {
                signalB();
                executionOrder.push('B');
            });

            await flushAll();
            executionOrder.length = 0;

            // In one sync block:
            // 1. Trigger effect A (adds to batch via batchedAdd, lastAddedId = A.id)
            // 2. Create new effect C (should update lastAddedId to C.id, the highest)
            // 3. Trigger effect B (adds to batch via batchedAdd)
            //
            // If lastAddedId is not updated when C is created:
            // - After step 1: lastAddedId = A.id
            // - After step 2: lastAddedId still = A.id (BUG: should be C.id)
            // - After step 3: B.id > lastAddedId, so needsSort stays false
            // - Batch order is [A, C, B] but needsSort=false, so no sort happens
            // - Execution order would be A, C, B instead of A, B, C
            signalA.set(1);  // Marks A dirty, adds via batchedAdd

            // Create effect C (highest id) - if this doesn't update lastAddedId, ordering breaks
            effect(() => {
                executionOrder.push('C');
            });

            signalB.set(1);  // Marks B dirty, adds via batchedAdd

            await flushAll();

            // Effects should execute in creation order: A, B, C
            // If lastAddedId bug exists, order might be A, C, B (insertion order)
            expect(executionOrder).toEqual(['A', 'B', 'C']);
        });

        it('late-subscribing effect maintains creation order position', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const control = state({ subscribe: false });
            const store = state({ value: 0 });

            // Effect 0: always subscribes to store
            effect(() => {
                store.value;
                executionOrder.push(0);
            });

            // Effect 1: only subscribes to store when control.subscribe is true
            effect(() => {
                if (control.subscribe) {
                    store.value;
                }
                executionOrder.push(1);
            });

            // Effect 2: always subscribes to store
            effect(() => {
                store.value;
                executionOrder.push(2);
            });

            await flushAll();
            executionOrder.length = 0;

            // Change store - effect 1 is not subscribed, should get [0, 2]
            store.value = 1;
            await flushAll();
            expect(executionOrder).toEqual([0, 2]);

            executionOrder.length = 0;

            // Enable subscription for effect 1
            control.subscribe = true;
            await flushAll();
            executionOrder.length = 0;

            // Now change store - effect 1 subscribed AFTER effect 2 but should still run in creation order
            store.value = 2;
            await flushAll();
            expect(executionOrder).toEqual([0, 1, 2]);
        });
    });
});

describe('effect with signals', () => {
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
        const count = signal(0);

        effect(() => {
            subscriber(count());
        });

        // Effect hasn't run yet
        expect(subscriber).not.toHaveBeenCalled();

        await flushAll();

        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);
    });

    it('re-runs when dependencies change', async () => {
        const subscriber = vi.fn();
        const count = signal(0);

        effect(() => {
            subscriber(count());
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);

        count.set(5);
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(2);
        expect(subscriber).toHaveBeenCalledWith(5);
    });

    it('does not re-run when untracked signals change', async () => {
        const subscriber = vi.fn();
        const tracked = signal('tracked');
        const untracked = signal('untracked');

        effect(() => {
            subscriber(tracked());
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        untracked.set('changed');
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        tracked.set('changed');
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('supports cleanup function', async () => {
        let cleanupCalled = false;
        const count = signal(0);

        effect(() => {
            count();
            return () => {
                cleanupCalled = true;
            };
        });

        await flushAll();
        expect(cleanupCalled).toBe(false);

        count.set(1);
        await flushAll();
        expect(cleanupCalled).toBe(true);
    });

    it('cleanup is called before each re-run', async () => {
        /** @type {string[]} */
        const calls = [];
        const count = signal(0);

        effect(() => {
            const currentCount = count();
            calls.push(`run:${currentCount}`);
            return () => {
                calls.push(`cleanup:${currentCount}`);
            };
        });

        await flushAll();
        expect(calls).toEqual(['run:0']);

        count.set(1);
        await flushAll();
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1']);

        count.set(2);
        await flushAll();
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
    });

    it('dispose stops effect from running', async () => {
        const subscriber = vi.fn();
        const count = signal(0);

        const dispose = effect(() => {
            subscriber(count());
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        dispose();

        count.set(1);
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('dispose calls cleanup function', async () => {
        let cleanupCalled = false;
        const count = signal(0);

        const dispose = effect(() => {
            count();
            return () => {
                cleanupCalled = true;
            };
        });

        await flushAll();
        expect(cleanupCalled).toBe(false);

        dispose();
        expect(cleanupCalled).toBe(true);
    });

    it('only tracks accessed signals', async () => {
        let nameRuns = 0;
        let ageRuns = 0;
        const name = signal('John');
        const age = signal(30);

        effect(() => {
            name();
            nameRuns++;
        });

        effect(() => {
            age();
            ageRuns++;
        });

        await flushAll();
        expect(nameRuns).toBe(1);
        expect(ageRuns).toBe(1);

        name.set('Jane');
        await flushAll();
        expect(nameRuns).toBe(2);
        expect(ageRuns).toBe(1);

        age.set(25);
        await flushAll();
        expect(nameRuns).toBe(2);
        expect(ageRuns).toBe(2);
    });

    it('handles conditional dependencies', async () => {
        let runs = 0;
        const flag = signal(true);
        const a = signal(1);
        const b = signal(2);

        effect(() => {
            runs++;
            if (flag()) {
                a();
            } else {
                b();
            }
        });

        await flushAll();
        expect(runs).toBe(1);

        // Change a (tracked because flag is true)
        a.set(10);
        await flushAll();
        expect(runs).toBe(2);

        // Change b (not tracked because flag is true)
        b.set(20);
        await flushAll();
        expect(runs).toBe(2);

        // Switch flag
        flag.set(false);
        await flushAll();
        expect(runs).toBe(3);

        // Now a is not tracked, b is
        a.set(100);
        await flushAll();
        expect(runs).toBe(3);

        b.set(200);
        await flushAll();
        expect(runs).toBe(4);
    });

    it('does not run if value is the same', async () => {
        let runs = 0;
        const count = signal(5);

        effect(() => {
            count();
            runs++;
        });

        await flushAll();
        expect(runs).toBe(1);

        count.set(5); // Same value
        await flushAll();
        expect(runs).toBe(1);
    });

    it('self-dispose within effect', async () => {
        let runs = 0;
        const count = signal(0);

        /** @type {(() => void) | undefined} */
        let dispose;

        dispose = effect(() => {
            runs++;
            const c = count();
            if (c >= 2) {
                dispose?.();
            }
        });

        await flushAll();
        expect(runs).toBe(1);

        count.set(1);
        await flushAll();
        expect(runs).toBe(2);

        count.set(2); // This triggers self-dispose
        await flushAll();
        expect(runs).toBe(3);

        count.set(3); // Should not run
        await flushAll();
        expect(runs).toBe(3);
    });

    it('multiple signals in single effect', async () => {
        let runs = 0;
        const a = signal(1);
        const b = signal(2);

        effect(() => {
            runs++;
            a() + b();
        });

        await flushAll();
        expect(runs).toBe(1);

        a.set(10);
        await flushAll();
        expect(runs).toBe(2);

        b.set(20);
        await flushAll();
        expect(runs).toBe(3);

        // Both at once (batched)
        a.set(100);
        b.set(200);
        await flushAll();
        expect(runs).toBe(4);
    });

    it('dispose before first run cancels effect', async () => {
        const subscriber = vi.fn();
        const count = signal(0);

        const dispose = effect(() => {
            subscriber(count());
        });

        dispose(); // Dispose before flush

        await flushAll();
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('effect depending on computed clears computed sources on re-run', async () => {
        const value = signal(0);
        let effectRuns = 0;

        const doubled = computed(() => value() * 2);

        effect(() => {
            effectRuns++;
            doubled();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        value.set(5);
        await flushAll();
        expect(effectRuns).toBe(2);
    });

    it('effect disposed after being marked dirty but before flush', async () => {
        const subscriber = vi.fn();
        const value = signal(0);

        const dispose = effect(() => {
            subscriber(value());
        });

        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);

        value.set(1);
        dispose();
        await flushAll();
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('computed dependency is properly tracked in effect', async () => {
        const a = signal(1);
        const b = signal(2);
        let effectRuns = 0;

        const sum = computed(() => a() + b());

        effect(() => {
            effectRuns++;
            sum();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        a.set(10);
        await flushAll();
        expect(effectRuns).toBe(2);

        b.set(20);
        await flushAll();
        expect(effectRuns).toBe(3);
    });

    it('effect on computed chain clears sources properly on each run', async () => {
        const value = signal(0);
        let effectRuns = 0;
        let computeARuns = 0;
        let computeBRuns = 0;

        const a = computed(() => {
            computeARuns++;
            return value() + 1;
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

        value.set(5);
        await flushAll();
        expect(effectRuns).toBe(2);
        expect(computeARuns).toBe(2);
        expect(computeBRuns).toBe(2);
    });

    it('multiple effects disposed before flush only run remaining ones', async () => {
        const value = signal(0);
        let effect1Runs = 0;
        let effect2Runs = 0;
        let effect3Runs = 0;

        const dispose1 = effect(() => {
            effect1Runs++;
            value();
        });

        const dispose2 = effect(() => {
            effect2Runs++;
            value();
        });

        effect(() => {
            effect3Runs++;
            value();
        });

        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(1);

        value.set(1);
        dispose1();
        dispose2();
        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);
        expect(effect3Runs).toBe(2);
    });

    it('effect disposed while another effect runs during flush', async () => {
        const value = signal(0);
        let effect1Runs = 0;
        let effect2Runs = 0;

        /** @type {(() => void) | undefined} */
        let dispose2;

        effect(() => {
            effect1Runs++;
            value();
            if (value() === 1) {
                dispose2?.();
            }
        });

        dispose2 = effect(() => {
            effect2Runs++;
            value();
        });

        await flushAll();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        value.set(1);
        await flushAll();
        expect(effect1Runs).toBe(2);
        // effect2 may or may not run depending on order
    });

    it('effect that changes its own dependency during execution', async () => {
        const value = signal(0);
        let runs = 0;

        effect(() => {
            runs++;
            const v = value();
            if (v === 0) {
                value.set(1);
            }
        });

        await flushAll();
        expect(runs).toBe(2);
        expect(value()).toBe(1);
    });

    it('computed depending on computed with effect exercises all code paths', async () => {
        const base = signal(0);
        let effectRuns = 0;

        const level1 = computed(() => base() + 1);
        const level2 = computed(() => level1() * 2);
        const level3 = computed(() => level2() + 10);

        const dispose = effect(() => {
            effectRuns++;
            level3();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        base.set(5);
        await flushAll();
        expect(effectRuns).toBe(2);

        base.set(10);
        await flushAll();
        expect(effectRuns).toBe(3);

        dispose();
    });

    it('effect with only computed dependencies (no direct signal access)', async () => {
        const x = signal(2);
        const y = signal(3);
        let effectRuns = 0;

        const sum = computed(() => x() + y());
        const product = computed(() => x() * y());

        const dispose = effect(() => {
            effectRuns++;
            sum();
            product();
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        x.set(4);
        await flushAll();
        expect(effectRuns).toBe(2);

        y.set(5);
        await flushAll();
        expect(effectRuns).toBe(3);

        dispose();
    });

    it('rapidly creating and disposing effects', async () => {
        const value = signal(0);
        /** @type {(() => void)[]} */
        const disposes = [];

        for (let i = 0; i < 10; i++) {
            const dispose = effect(() => {
                value();
            });
            disposes.push(dispose);
        }

        await flushAll();

        // Dispose half
        for (let i = 0; i < 5; i++) {
            disposes[i]?.();
        }

        value.set(1);
        await flushAll();

        // Dispose rest
        for (let i = 5; i < 10; i++) {
            disposes[i]?.();
        }
    });

    it('effect re-run clears previous computed dependencies', async () => {
        const flag = signal(true);
        const a = signal(1);
        const b = signal(2);
        let effectRuns = 0;

        const compA = computed(() => a() * 10);
        const compB = computed(() => b() * 10);

        effect(() => {
            effectRuns++;
            if (flag()) {
                compA();
            } else {
                compB();
            }
        });

        await flushAll();
        expect(effectRuns).toBe(1);

        // a is tracked
        a.set(5);
        await flushAll();
        expect(effectRuns).toBe(2);

        // b is not tracked
        b.set(10);
        await flushAll();
        expect(effectRuns).toBe(2);

        // Switch
        flag.set(false);
        await flushAll();
        expect(effectRuns).toBe(3);

        // Now b is tracked, a is not
        a.set(100);
        await flushAll();
        expect(effectRuns).toBe(3);

        b.set(200);
        await flushAll();
        expect(effectRuns).toBe(4);
    });

    it('does not call truthy non-function return value as cleanup', async () => {
        const count = signal(0);
        let runs = 0;

        // @ts-expect-error
        effect(() => {
            runs++;
            count();
            // Return a truthy non-function value
            return { notAFunction: true };
        });

        await flushAll();
        expect(runs).toBe(1);

        count.set(1);
        await flushAll();
        expect(runs).toBe(2);
    });

    describe('execution order', () => {
        it('effects execute in creation order on initial run', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const value = signal(0);

            effect(() => {
                value();
                executionOrder.push(1);
            });

            effect(() => {
                value();
                executionOrder.push(2);
            });

            effect(() => {
                value();
                executionOrder.push(3);
            });

            await flushAll();
            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('effects execute in creation order on re-run', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const value = signal(0);

            effect(() => {
                value();
                executionOrder.push(1);
            });

            effect(() => {
                value();
                executionOrder.push(2);
            });

            effect(() => {
                value();
                executionOrder.push(3);
            });

            await flushAll();
            executionOrder.length = 0;

            value.set(1);
            await flushAll();
            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('effects on different signals execute in creation order', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const a = signal(0);
            const b = signal(0);

            effect(() => {
                a();
                executionOrder.push(1);
            });

            effect(() => {
                b();
                executionOrder.push(2);
            });

            effect(() => {
                a();
                b();
                executionOrder.push(3);
            });

            await flushAll();
            executionOrder.length = 0;

            a.set(1);
            b.set(1);
            await flushAll();
            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('effects with diamond dependency execute in creation order', async () => {
            /** @type {number[]} */
            const executionOrder = [];
            const value = signal(0);

            const compA = computed(() => value() + 1);
            const compB = computed(() => value() + 2);

            effect(() => {
                compA();
                compB();
                executionOrder.push(1);
            });

            effect(() => {
                compA();
                executionOrder.push(2);
            });

            effect(() => {
                compB();
                executionOrder.push(3);
            });

            await flushAll();
            executionOrder.length = 0;

            value.set(1);
            await flushAll();
            expect(executionOrder).toEqual([1, 2, 3]);
        });
    });
});
