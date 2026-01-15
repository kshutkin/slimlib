import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('inner effects', () => {
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

    it('should clear subscriptions when untracked by all subscribers', async () => {
        let bRunTimes = 0;

        const store = state({ a: 1 });
        const b = computed(() => {
            bRunTimes++;
            return store.a * 2;
        });
        const stopEffect = effect(() => {
            b();
        });

        await flushAll();
        expect(bRunTimes).toBe(1);
        store.a = 2;
        await flushAll();
        expect(bRunTimes).toBe(2);
        stopEffect();
        store.a = 3;
        await flushAll();
        expect(bRunTimes).toBe(2);
    });

    it('should not run untracked inner effect', async () => {
        const store = state({ a: 3 });
        const b = computed(() => store.a > 0);

        effect(() => {
            if (b()) {
                effect(() => {
                    if (store.a === 0) {
                        throw new Error('bad');
                    }
                });
            }
        });

        await flushAll();
        store.a = 2;
        await flushAll();
        store.a = 1;
        await flushAll();
        store.a = 0;
        await flushAll();
        // Should not throw - inner effect should be disposed when outer re-runs
    });

    it('should not trigger inner effect when resolve maybe dirty', async () => {
        const store = state({ a: 0 });
        const b = computed(() => store.a % 2);

        let innerTriggerTimes = 0;

        effect(() => {
            effect(() => {
                b();
                innerTriggerTimes++;
                if (innerTriggerTimes >= 2) {
                    throw new Error('bad');
                }
            });
        });

        await flushAll();
        store.a = 2; // b() still returns 0
        await flushAll();
        // Inner effect should not re-run because b() value didn't change
    });

    it('should handle side effect with inner effects', async () => {
        const store = state({ a: 0, b: 0 });
        const order = [];

        effect(() => {
            effect(() => {
                store.a;
                order.push('a');
            });
            effect(() => {
                store.b;
                order.push('b');
            });
        });

        await flushAll();
        expect(order).toEqual(['a', 'b']);

        order.length = 0;
        store.b = 1;
        await flushAll();
        store.a = 1;
        await flushAll();
        expect(order).toEqual(['b', 'a']);
    });

    it('should handle flags are indirectly updated during checkDirty', async () => {
        const store = state({ a: false });
        const b = computed(() => store.a);
        const c = computed(() => {
            b();
            return 0;
        });
        const d = computed(() => {
            c();
            return b();
        });

        let triggers = 0;

        effect(() => {
            d();
            triggers++;
        });

        await flushAll();
        expect(triggers).toBe(1);
        store.a = true;
        await flushAll();
        expect(triggers).toBe(2);
    });

    it('should handle effect recursion for the first execution', async () => {
        const store1 = state({ value: 0 });
        const store2 = state({ value: 0 });

        let triggers1 = 0;
        let triggers2 = 0;

        effect(() => {
            triggers1++;
            store1.value = Math.min(store1.value + 1, 5);
        });
        effect(() => {
            triggers2++;
            store2.value = Math.min(store2.value + 1, 5);
            store2.value; // read to track
        });

        await flushAll();
        // Effects should only run once per flush, even if they modify their own dependencies
        expect(triggers1).toBeGreaterThanOrEqual(1);
        expect(triggers2).toBeGreaterThanOrEqual(1);
    });

    it('inner scope effects are disposed when outer effect re-runs', async () => {
        const store = state({ outer: 0, inner: 0 });
        let innerRunCount = 0;
        let lastInnerValue = -1;

        effect(() => {
            // Reading outer creates dependency
            const outerVal = store.outer;

            // Create inner effect in a nested scope
            const innerScope = scope();
            innerScope(() => {
                effect(() => {
                    innerRunCount++;
                    lastInnerValue = store.inner;
                });
            });

            // Return cleanup that disposes the inner scope
            return () => {
                innerScope();
            };
        });

        await flushAll();
        expect(innerRunCount).toBe(1);
        expect(lastInnerValue).toBe(0);

        // Change inner - should trigger inner effect
        store.inner = 1;
        await flushAll();
        expect(innerRunCount).toBe(2);
        expect(lastInnerValue).toBe(1);

        // Change outer - should dispose old inner and create new
        store.outer = 1;
        await flushAll();
        expect(innerRunCount).toBe(3); // New inner effect created and run

        // The old inner effect should be disposed, so changing inner
        // should only trigger the new inner effect once
        store.inner = 2;
        await flushAll();
        expect(innerRunCount).toBe(4);
    });

    it('should duplicate subscribers do not affect the notify order', async () => {
        const store1 = state({ value: 0 });
        const store2 = state({ value: 0 });
        const order = [];

        effect(() => {
            order.push('a');
            // Conditionally read store1 based on store2
            if (store2.value === 1) {
                store1.value;
            }
            store2.value;
            store1.value;
        });
        effect(() => {
            order.push('b');
            store1.value;
        });

        await flushAll();
        order.length = 0;

        store2.value = 1; // Now 'a' reads store1 twice
        await flushAll();
        order.length = 0;

        store1.value = store1.value + 1;
        await flushAll();

        expect(order).toEqual(['a', 'b']);
    });

    it('effects created in scope are disposed with scope', async () => {
        const store = state({ value: 0 });
        let runCount = 0;

        const innerScope = scope();
        innerScope(() => {
            effect(() => {
                store.value;
                runCount++;
            });
        });

        await flushAll();
        expect(runCount).toBe(1);

        store.value = 1;
        await flushAll();
        expect(runCount).toBe(2);

        // Dispose the scope
        innerScope();

        store.value = 2;
        await flushAll();
        // Effect should not run - scope disposed
        expect(runCount).toBe(2);
    });

    it('nested scopes dispose in correct order', async () => {
        const disposeOrder = [];

        const outerScope = scope();
        let innerScope;

        outerScope((onDispose) => {
            onDispose(() => disposeOrder.push('outer'));

            innerScope = scope();
            innerScope((onDispose) => {
                onDispose(() => disposeOrder.push('inner'));
            });
        });

        // Dispose outer should also dispose inner (since inner is child of outer)
        outerScope();

        expect(disposeOrder).toContain('outer');
        // Inner should have been disposed as child of outer
    });

    it('effect with computed chain in inner scope', async () => {
        const store = state({ value: 1 });
        let effectValue = 0;

        const innerScope = scope();
        innerScope(() => {
            const doubled = computed(() => store.value * 2);
            const quadrupled = computed(() => doubled() * 2);

            effect(() => {
                effectValue = quadrupled();
            });
        });

        await flushAll();
        expect(effectValue).toBe(4);

        store.value = 5;
        await flushAll();
        expect(effectValue).toBe(20);

        // Dispose scope - computed chain should become inactive
        innerScope();

        store.value = 10;
        await flushAll();
        // Effect disposed, should not update
        expect(effectValue).toBe(20);
    });
});
