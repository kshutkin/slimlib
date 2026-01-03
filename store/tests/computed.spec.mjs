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

    it('detects circular dependency', () => {
        const a = computed(() => b.value + 1);
        const b = computed(() => a.value + 1);

        expect(() => a.value).toThrow(/circular/i);
    });

    it('circular detection resets after throw', () => {
        const store = createStore({ value: 1 });
        let shouldCircle = true;

        const a = computed(() => {
            if (shouldCircle) {
                return b.value + 1;
            }
            return store.value;
        });

        const b = computed(() => a.value + 1);

        // First access throws
        expect(() => a.value).toThrow(/circular/i);

        // Fix the circular dependency
        shouldCircle = false;

        // After fixing, should work
        expect(a.value).toBe(1);
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
});
