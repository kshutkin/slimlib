import { describe, expect, it } from 'vitest';

import { computed, createStore, effect } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('diamond problem', () => {
    /**
     * Diamond Problem:
     *
     *      A (signal/store)
     *     / \
     *    B   C (computed)
     *     \ /
     *      D (effect)
     *
     * When A changes, both B and C depend on it.
     * D depends on both B and C.
     * D should only run ONCE, not twice.
     */

    it('effect runs once when source changes (diamond via computed)', async () => {
        const store = createStore({ a: 0 });
        const b = computed(() => store.a + 1);
        const c = computed(() => store.a + 2);
        let runCount = 0;

        effect(() => {
            b.value + c.value;
            runCount++;
        });

        await flushPromises();
        expect(runCount).toBe(1); // Initial run

        store.a = 1;
        await flushPromises();
        expect(runCount).toBe(2); // One update, not 3!
    });

    it('effect runs once when multiple computed share same source', async () => {
        const store = createStore({ value: 1 });

        const doubled = computed(() => store.value * 2);
        const tripled = computed(() => store.value * 3);
        const quadrupled = computed(() => store.value * 4);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            result = doubled.value + tripled.value + quadrupled.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        expect(result).toBe(2 + 3 + 4); // 9

        store.value = 2;
        await flushPromises();
        expect(runCount).toBe(2); // Only one additional run
        expect(result).toBe(4 + 6 + 8); // 18
    });

    it('complex diamond with computed chain', async () => {
        /**
         *        A
         *       /|\
         *      B C D (computed)
         *      |/ \|
         *      E   F (computed)
         *       \ /
         *        G (effect)
         */
        const store = createStore({ a: 1 });

        const b = computed(() => store.a + 1);
        const c = computed(() => store.a + 2);
        const d = computed(() => store.a + 3);

        const e = computed(() => b.value + c.value);
        const f = computed(() => c.value + d.value);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            result = e.value + f.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        // e = (1+1) + (1+2) = 5
        // f = (1+2) + (1+3) = 7
        // result = 12
        expect(result).toBe(12);

        store.a = 10;
        await flushPromises();
        expect(runCount).toBe(2); // Still only one update
        // e = (10+1) + (10+2) = 23
        // f = (10+2) + (10+3) = 25
        // result = 48
        expect(result).toBe(48);
    });

    it('diamond with direct store access in effect', async () => {
        /**
         *      A (store)
         *     /|\
         *    / | \
         *   B  C  (effect reads A, B, C)
         */
        const store = createStore({ a: 1 });
        const b = computed(() => store.a * 2);
        const c = computed(() => store.a * 3);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            // Effect reads store directly AND both computed values
            result = store.a + b.value + c.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        expect(result).toBe(1 + 2 + 3);

        store.a = 5;
        await flushPromises();
        expect(runCount).toBe(2); // One update
        expect(result).toBe(5 + 10 + 15);
    });

    it('multiple effects on same diamond', async () => {
        const store = createStore({ value: 1 });
        const b = computed(() => store.value * 2);
        const c = computed(() => store.value * 3);

        let effect1Runs = 0;
        let effect2Runs = 0;

        effect(() => {
            effect1Runs++;
            b.value + c.value;
        });

        effect(() => {
            effect2Runs++;
            b.value + c.value;
        });

        await flushPromises();
        expect(effect1Runs).toBe(1);
        expect(effect2Runs).toBe(1);

        store.value = 2;
        await flushPromises();
        expect(effect1Runs).toBe(2);
        expect(effect2Runs).toBe(2);
    });

    it('diamond with conditional computed access', async () => {
        const store = createStore({ value: 1, flag: true });
        const doubled = computed(() => store.value * 2);
        const tripled = computed(() => store.value * 3);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            // Conditionally access computed values
            result = store.flag ? doubled.value : tripled.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        expect(result).toBe(2);

        store.value = 5;
        await flushPromises();
        expect(runCount).toBe(2);
        expect(result).toBe(10);

        // Switch branch
        store.flag = false;
        await flushPromises();
        expect(runCount).toBe(3);
        expect(result).toBe(15);
    });

    it('deeply nested diamond', async () => {
        const store = createStore({ value: 1 });

        // Two branches that eventually merge
        const a1 = computed(() => store.value + 1);
        const a2 = computed(() => a1.value + 1);
        const a3 = computed(() => a2.value + 1);

        const b1 = computed(() => store.value + 10);
        const b2 = computed(() => b1.value + 10);
        const b3 = computed(() => b2.value + 10);

        // Merge point
        const merge = computed(() => a3.value + b3.value);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            result = merge.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        // a3 = 1 + 1 + 1 + 1 = 4
        // b3 = 1 + 10 + 10 + 10 = 31
        expect(result).toBe(4 + 31);

        store.value = 100;
        await flushPromises();
        expect(runCount).toBe(2); // Still only one update
        // a3 = 100 + 1 + 1 + 1 = 103
        // b3 = 100 + 10 + 10 + 10 = 130
        expect(result).toBe(103 + 130);
    });

    it('multiple sources feeding into diamond', async () => {
        const store1 = createStore({ x: 1 });
        const store2 = createStore({ y: 2 });

        const sum = computed(() => store1.x + store2.y);
        const product = computed(() => store1.x * store2.y);

        let runCount = 0;
        let result;

        effect(() => {
            runCount++;
            result = sum.value + product.value;
        });

        await flushPromises();
        expect(runCount).toBe(1);
        expect(result).toBe(3 + 2); // sum=3, product=2

        // Change store1
        store1.x = 5;
        await flushPromises();
        expect(runCount).toBe(2);
        expect(result).toBe(7 + 10); // sum=7, product=10

        // Change store2
        store2.y = 3;
        await flushPromises();
        expect(runCount).toBe(3);
        expect(result).toBe(8 + 15); // sum=8, product=15
    });

    it('computed values are correct after diamond resolution', async () => {
        const store = createStore({ a: 1 });
        const b = computed(() => store.a + 10);
        const c = computed(() => store.a + 20);

        let effectB, effectC;

        effect(() => {
            effectB = b.value;
            effectC = c.value;
        });

        await flushPromises();
        expect(effectB).toBe(11);
        expect(effectC).toBe(21);

        store.a = 5;
        await flushPromises();
        // Both should be updated correctly
        expect(effectB).toBe(15);
        expect(effectC).toBe(25);
    });
});
