import { describe, expect, it } from 'vitest';

import { computed, effect, flush, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    flush();
    await flushPromises();
}

describe('computed with equality comparison', () => {
    it('uses default Object.is equality', async () => {
        const store = state({ count: 0 });
        let computeCount = 0;

        const doubled = computed(() => {
            computeCount++;
            return store.count * 2;
        });

        // First access
        expect(doubled()).toBe(0);
        expect(computeCount).toBe(1);

        // Change to different value
        store.count = 5;
        await flushAll();
        expect(doubled()).toBe(10);
        expect(computeCount).toBe(2);

        // Change to produce same result (5 * 2 = 10)
        store.count = 5;
        await flushAll();
        expect(doubled()).toBe(10);
        expect(computeCount).toBe(2); // Should not recompute when value unchanged
    });

    it('stops cascade when value unchanged', async () => {
        const store = state({ count: 0 });
        let compute1Count = 0;
        let compute2Count = 0;
        let compute3Count = 0;

        const doubled = computed(() => {
            compute1Count++;
            return store.count * 2;
        });

        const isEven = computed(() => {
            compute2Count++;
            return doubled() % 2 === 0;
        });

        const message = computed(() => {
            compute3Count++;
            return isEven() ? 'Even' : 'Odd';
        });

        // Initial access
        expect(message()).toBe('Even');
        expect(compute1Count).toBe(1);
        expect(compute2Count).toBe(1);
        expect(compute3Count).toBe(1);

        // Change count: 0 → 2 (doubled: 0 → 4, isEven: true → true, message: 'Even' → 'Even')
        store.count = 2;
        await flushAll();

        expect(message()).toBe('Even');
        expect(compute1Count).toBe(2); // doubled recomputes
        expect(compute2Count).toBe(2); // isEven recomputes
        expect(compute3Count).toBe(1); // message should NOT recompute (lazy propagation stopped)
    });

    it('prevents downstream recomputation with custom equality', async () => {
        const store = state({ items: [1, 2, 3] });
        let compute1Count = 0;
        let compute2Count = 0;

        /** @type {(a: unknown, b: unknown) => boolean} */
        const deepEquals = (a, b) => {
            if (a === b) return true;
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            return a.every((val, idx) => val === b[idx]);
        };

        const filtered = computed(() => {
            compute1Count++;
            return store.items.filter(x => x > 0);
        }, deepEquals);

        const length = computed(() => {
            compute2Count++;
            return filtered().length;
        });

        // Initial
        expect(length()).toBe(3);
        expect(compute1Count).toBe(1);
        expect(compute2Count).toBe(1);

        // Change to same content
        store.items = [1, 2, 3];
        await flushAll();

        // Access length
        expect(length()).toBe(3);
        expect(compute1Count).toBe(2); // filtered recomputes
        expect(compute2Count).toBe(1); // length should not recompute (filtered returned equal value)
    });

    it('works with primitive value equality', async () => {
        const store = state({ a: 1, b: 2 });
        let computeCount = 0;
        let downstreamCount = 0;

        const sum = computed(() => {
            computeCount++;
            return store.a + store.b;
        });

        const doubled = computed(() => {
            downstreamCount++;
            return sum() * 2;
        });

        // Initial
        expect(doubled()).toBe(6);
        expect(computeCount).toBe(1);
        expect(downstreamCount).toBe(1);

        // Change a: 1 → 2, b: 2 → 1 (sum stays 3)
        store.a = 2;
        store.b = 1;
        await flushAll();

        expect(doubled()).toBe(6);
        expect(computeCount).toBe(2); // sum recomputes
        expect(downstreamCount).toBe(1); // doubled should not recompute
    });

    it('always propagates on first computation', async () => {
        const store = state({ value: 5 });
        let compute1Count = 0;
        let compute2Count = 0;

        const identity = computed(() => {
            compute1Count++;
            return store.value;
        });

        const doubled = computed(() => {
            compute2Count++;
            return identity() * 2;
        });

        // Access doubled
        expect(doubled()).toBe(10);
        expect(compute1Count).toBe(1);
        expect(compute2Count).toBe(1);
    });

    it('maintains correct state after error recovery', async () => {
        const store = state({ value: 1 });
        let computeCount = 0;

        const throwOnZero = computed(() => {
            computeCount++;
            if (store.value === 0) throw new Error('Zero not allowed');
            return store.value * 2;
        });

        // Initial
        expect(throwOnZero()).toBe(2);
        expect(computeCount).toBe(1);

        // Cause error
        store.value = 0;
        await flushAll();

        expect(() => throwOnZero()).toThrow('Zero not allowed');
        expect(computeCount).toBe(2);

        // Recover
        store.value = 1;
        await flushAll();

        expect(throwOnZero()).toBe(2);
        expect(computeCount).toBe(3);
    });

    it('handles multiple dependency chains with lazy propagation', async () => {
        const store = state({ x: 1, y: 2 });
        const counters = { a: 0, b: 0, c: 0, d: 0 };

        const a = computed(() => {
            counters.a++;
            return store.x + store.y;
        });

        const b = computed(() => {
            counters.b++;
            return a() * 2;
        });

        const c = computed(() => {
            counters.c++;
            return a() > 5 ? 'big' : 'small';
        });

        const d = computed(() => {
            counters.d++;
            return `${b()} is ${c()}`;
        });

        // Initial
        expect(d()).toBe('6 is small');
        expect(counters).toEqual({ a: 1, b: 1, c: 1, d: 1 });

        // Change x: 1 → 2, y: 2 → 1 (a stays 3)
        store.x = 2;
        store.y = 1;
        await flushAll();

        expect(d()).toBe('6 is small');
        expect(counters.a).toBe(2); // a recomputes
        expect(counters.b).toBe(1); // b should not recompute (a returned same value)
        expect(counters.c).toBe(1); // c should not recompute (a returned same value)
        expect(counters.d).toBe(1); // d should not recompute (no dependencies changed)
    });

    it('always propagates with custom always-false equality', async () => {
        const store = state({ value: 1 });
        let compute1Count = 0;
        let compute2Count = 0;

        const alwaysNew = computed(
            () => {
                compute1Count++;
                return store.value;
            },
            () => false
        ); // Never equal

        const downstream = computed(() => {
            compute2Count++;
            return alwaysNew() * 2;
        });

        // Initial
        expect(downstream()).toBe(2);
        expect(compute1Count).toBe(1);
        expect(compute2Count).toBe(1);

        // Set to different value (but would compute to same result if equals worked normally)
        store.value = 2;
        await flushAll();

        expect(downstream()).toBe(4);
        expect(compute1Count).toBe(2); // alwaysNew recomputes
        expect(compute2Count).toBe(2); // downstream recomputes (equals always returns false)
    });

    it('never propagates after first with custom always-true equality', async () => {
        const store = state({ value: 1 });
        let compute1Count = 0;
        let compute2Count = 0;

        const alwaysSame = computed(
            () => {
                compute1Count++;
                return store.value;
            },
            () => true
        ); // Always equal

        const downstream = computed(() => {
            compute2Count++;
            return alwaysSame() * 2;
        });

        // Initial
        expect(downstream()).toBe(2);
        expect(compute1Count).toBe(1);
        expect(compute2Count).toBe(1);

        // Change value
        store.value = 100;
        await flushAll();

        // Access downstream
        const currentValue = downstream();
        expect(compute1Count).toBe(2); // alwaysSame recomputes
        expect(compute2Count).toBe(1); // downstream does not recompute (equals returns true)

        // downstream still has old cached value because alwaysSame didn't propagate change
        expect(currentValue).toBe(2);
    });

    it('handles deep object comparison with custom equality', async () => {
        const store = state({ user: { name: 'John', age: 30 } });
        let computeCount = 0;
        let downstreamCount = 0;

        /** @type {(a: Record<string, unknown> | unknown, b: Record<string, unknown> | unknown) => boolean} */
        const deepEquals = (a, b) => {
            if (a === b) return true;
            if (typeof a !== 'object' || typeof b !== 'object') return false;
            if (a === null || b === null) return false;
            const keysA = Object.keys(/** @type {object} */ (a));
            const keysB = Object.keys(/** @type {object} */ (b));
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => /** @type {Record<string, unknown>} */ (a)[key] === /** @type {Record<string, unknown>} */ (b)[key]);
        };

        const userCopy = computed(() => {
            computeCount++;
            return { ...store.user };
        }, deepEquals);

        const userName = computed(() => {
            downstreamCount++;
            return userCopy().name;
        });

        // Initial
        expect(userName()).toBe('John');
        expect(computeCount).toBe(1);
        expect(downstreamCount).toBe(1);

        // Change to same values
        store.user = { name: 'John', age: 30 };
        await flushAll();

        expect(userName()).toBe('John');
        expect(computeCount).toBe(2); // userCopy recomputes
        expect(downstreamCount).toBe(1); // userName doesn't recompute (deep equal)
    });

    it('effects run when sources change but regular computed use lazy propagation', async () => {
        const store = state({ count: 0 });
        let effectRunCount = 0;
        let computeCount = 0;

        const isEven = computed(() => {
            computeCount++;
            return store.count % 2 === 0;
        });

        const cleanup = effect(() => {
            effectRunCount++;
            isEven();
        });

        await flushAll();
        expect(effectRunCount).toBe(1);
        expect(computeCount).toBe(1);

        // Change 0 → 2 (both even, isEven value doesn't change)
        store.count = 2;
        await flushAll();

        // Effects are eagerly propagated to (they must run), but computed values
        // use lazy propagation with equality checking
        expect(effectRunCount).toBe(2); // Effect runs
        expect(computeCount).toBe(2); // isEven recomputes when effect accesses it

        // Change to odd value
        store.count = 3;
        await flushAll();

        expect(effectRunCount).toBe(3); // Effect runs again
        expect(computeCount).toBe(3); // isEven recomputes

        // Now test that regular computed (non-effect) uses lazy propagation
        let downstreamCount = 0;
        const message = computed(() => {
            downstreamCount++;
            return isEven() ? 'Even' : 'Odd';
        });

        expect(message()).toBe('Odd');
        expect(downstreamCount).toBe(1);

        // Change to another odd value - isEven value doesn't change
        store.count = 5;
        await flushAll();

        // Effect runs (eager), but message doesn't recompute (lazy)
        expect(effectRunCount).toBe(4);
        expect(computeCount).toBe(4);

        // Access message - it shouldn't have recomputed because isEven value didn't change
        expect(message()).toBe('Odd');
        expect(downstreamCount).toBe(1); // Still 1 - lazy propagation worked!

        cleanup();
    });

    it('complex chain with mixed equality functions', async () => {
        const store = state({ x: 1, y: 1 });
        const counters = { sum: 0, doubled: 0, message: 0 };

        const sum = computed(() => {
            counters.sum++;
            return store.x + store.y;
        });

        const doubled = computed(
            () => {
                counters.doubled++;
                return sum() * 2;
            },
            () => true // Always equal - never propagates
        );

        const message = computed(() => {
            counters.message++;
            return `Value is ${doubled()}`;
        });

        // Initial
        expect(message()).toBe('Value is 4');
        expect(counters).toEqual({ sum: 1, doubled: 1, message: 1 });

        // Change values
        store.x = 2;
        store.y = 3;
        await flushAll();

        expect(message()).toBe('Value is 4'); // Old value because doubled never propagates
        expect(counters.sum).toBe(2); // sum recomputes
        expect(counters.doubled).toBe(2); // doubled recomputes
        expect(counters.message).toBe(1); // message doesn't recompute
    });
});
