import { describe, expect, it } from 'vitest';

import { computed, effect, state, untracked } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('untracked', () => {
    it('prevents dependency tracking', async () => {
        let runs = 0;
        const store = state({ a: 1, b: 2 });

        effect(() => {
            runs++;
            store.a; // Tracked
            untracked(() => store.b); // Not tracked
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Changing b should NOT trigger effect
        store.b = 10;
        await flushPromises();
        expect(runs).toBe(1);

        // Changing a SHOULD trigger effect
        store.a = 5;
        await flushPromises();
        expect(runs).toBe(2);
    });

    it('returns the value from callback', () => {
        const store = state({ value: 42 });

        const result = untracked(() => store.value * 2);

        expect(result).toBe(84);
    });

    it('works with nested objects', async () => {
        let runs = 0;
        const store = state({ user: { name: 'John', age: 30 } });

        effect(() => {
            runs++;
            untracked(() => store.user.name);
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.user.name = 'Jane';
        await flushPromises();
        expect(runs).toBe(1); // Should not trigger
    });

    it('can be used inside computed', () => {
        const store = state({ a: 1, b: 2 });
        let computeCount = 0;

        const result = computed(() => {
            computeCount++;
            return store.a + untracked(() => store.b);
        });

        expect(result()).toBe(3);
        expect(computeCount).toBe(1);

        // Changing b should not cause recompute
        store.b = 10;
        expect(result()).toBe(3); // Still cached
        expect(computeCount).toBe(1);

        // Changing a should cause recompute
        store.a = 5;
        expect(result()).toBe(15); // 5 + 10
        expect(computeCount).toBe(2);
    });

    it('nested untracked calls work correctly', async () => {
        let runs = 0;
        const store = state({ a: 1, b: 2, c: 3 });

        effect(() => {
            runs++;
            untracked(() => {
                store.a;
                untracked(() => {
                    store.b;
                });
                store.c;
            });
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.a = 10;
        store.b = 20;
        store.c = 30;
        await flushPromises();
        expect(runs).toBe(1); // All were untracked
    });

    it('tracking resumes after untracked block', async () => {
        let runs = 0;
        const store = state({ a: 1, b: 2, c: 3 });

        effect(() => {
            runs++;
            store.a; // Tracked
            untracked(() => store.b); // Not tracked
            store.c; // Tracked again
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Changing a should trigger
        store.a = 10;
        await flushPromises();
        expect(runs).toBe(2);

        // Changing b should NOT trigger
        store.b = 20;
        await flushPromises();
        expect(runs).toBe(2);

        // Changing c should trigger
        store.c = 30;
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('handles exceptions inside untracked', async () => {
        let runs = 0;
        const store = state({ a: 1, b: 2 });

        effect(() => {
            runs++;
            store.a; // Tracked
            try {
                untracked(() => {
                    store.b;
                    throw new Error('test error');
                });
            } catch {
                // Ignore error
            }
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Tracking should still work after exception
        store.a = 10;
        await flushPromises();
        expect(runs).toBe(2);

        // b was still untracked despite exception
        store.b = 20;
        await flushPromises();
        expect(runs).toBe(2);
    });

    it('untracked with no effect context is a no-op', () => {
        const store = state({ value: 42 });

        // Should just return the value, no effect context
        const result = untracked(() => store.value);
        expect(result).toBe(42);
    });

    it('mix of tracked and untracked in same expression', async () => {
        let runs = 0;
        const store = state({ a: 1, b: 2, c: 3 });

        effect(() => {
            runs++;
            // Complex expression: track a, untrack b, then track c
            store.a + untracked(() => store.b) + store.c;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.b = 100; // Not tracked
        await flushPromises();
        expect(runs).toBe(1);

        store.a = 10; // Tracked
        await flushPromises();
        expect(runs).toBe(2);

        store.c = 30; // Tracked
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('untracked in loop', async () => {
        let runs = 0;
        const store = state({ items: [1, 2, 3], multiplier: 2 });

        effect(() => {
            runs++;
            // Track multiplier but not items
            const m = store.multiplier;
            untracked(() => store.items.reduce((acc, item) => acc + item * m, 0));
        });

        await flushPromises();
        expect(runs).toBe(1);

        // Changing items should NOT trigger
        store.items.push(4);
        await flushPromises();
        expect(runs).toBe(1);

        // Changing multiplier SHOULD trigger
        store.multiplier = 3;
        await flushPromises();
        expect(runs).toBe(2);
    });

    it('computed accessed inside untracked does not create dependency', async () => {
        let effectRuns = 0;
        let computeRuns = 0;
        const store = state({ value: 1 });

        const doubled = computed(() => {
            computeRuns++;
            return store.value * 2;
        });

        effect(() => {
            effectRuns++;
            untracked(() => doubled());
        });

        await flushPromises();
        expect(effectRuns).toBe(1);
        expect(computeRuns).toBe(1);

        // Changing store should recompute the computed but NOT re-run the effect
        store.value = 5;
        // Access the computed to trigger recomputation
        expect(doubled()).toBe(10);
        expect(computeRuns).toBe(2);

        await flushPromises();
        // Effect should NOT have run again
        expect(effectRuns).toBe(1);
    });
});
