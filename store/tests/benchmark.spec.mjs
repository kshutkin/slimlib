/**
 * Minimal correctness tests for benchmark scenarios
 * Ensures the reactive system can handle all benchmark patterns
 */

import { describe, expect, it } from 'vitest';

import { computed, effect, flush, signal } from '../src/index.js';

describe('Benchmark Scenario Correctness', () => {
    it('deepPropagation', () => {
        const head = signal(0);
        /** @type {any} */
        let current = head;
        for (let i = 0; i < 50; i++) {
            const c = current;
            current = computed(() => c() + 1);
        }
        /** @type {number | undefined} */
        let lastValue;
        const dispose = effect(() => {
            lastValue = current();
        });
        flush();
        expect(lastValue).toBe(50);
        head.set(1);
        flush();
        expect(current()).toBe(51);
        expect(lastValue).toBe(51);
        dispose();
    });

    it('broadPropagation', () => {
        const head = signal(0);
        /** @type {number[]} */
        const values = [];
        /** @type {Array<() => void>} */
        const disposers = [];
        for (let i = 0; i < 50; i++) {
            const idx = i;
            const c = computed(() => head() + idx);
            disposers.push(
                effect(() => {
                    values[idx] = c();
                })
            );
        }
        flush();
        expect(values[0]).toBe(0);
        expect(values[49]).toBe(49);
        head.set(1);
        flush();
        expect(values[0]).toBe(1);
        expect(values[49]).toBe(50);
        disposers.forEach(d => {
            d();
        });
    });

    it('diamond', () => {
        const head = signal(0);
        const nodes = [computed(() => head() + 1), computed(() => head() + 1)];
        const sum = computed(() => {
            const node0 = nodes[0];
            const node1 = nodes[1];
            if (!node0 || !node1) throw new Error('Missing nodes');
            return node0() + node1();
        });
        /** @type {number | undefined} */
        let lastValue;
        const dispose = effect(() => {
            lastValue = sum();
        });
        flush();
        expect(lastValue).toBe(2);
        head.set(1);
        flush();
        expect(sum()).toBe(4);
        expect(lastValue).toBe(4);
        dispose();
    });

    it('unstable (dynamic dependencies)', () => {
        const head = signal(0);
        const a = computed(() => head() * 2);
        const b = computed(() => -head());
        const c = computed(() => (head() % 2 ? a() : b()));
        /** @type {number | undefined} */
        let lastValue;
        const dispose = effect(() => {
            lastValue = c();
        });
        flush();
        expect(lastValue).toBe(-0); // 0 % 2 = 0, uses b() = -0
        head.set(1);
        flush();
        expect(c()).toBe(2); // 1 % 2 = 1, uses a() = 1*2 = 2
        expect(lastValue).toBe(2);
        head.set(2);
        flush();
        expect(c()).toBe(-2); // 2 % 2 = 0, uses b() = -2
        expect(lastValue).toBe(-2);
        dispose();
    });

    it('cellx layers', () => {
        const s = { p1: signal(1), p2: signal(2) };
        const layer = { p1: computed(() => s.p2()), p2: computed(() => s.p1() - s.p2()) };
        /** @type {number | undefined} */
        let lastP1;
        const dispose = effect(() => {
            lastP1 = layer.p1();
        });
        flush();
        expect(lastP1).toBe(2);
        s.p1.set(4);
        s.p2.set(3);
        flush();
        expect(layer.p1()).toBe(3);
        expect(layer.p2()).toBe(1);
        expect(lastP1).toBe(3);
        dispose();
    });
});
