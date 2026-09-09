import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

describe('mixed source equality cutoff', () => {
    let testScope;

    beforeEach(() => {
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
        flushEffects();
    });

    for (const kind of ['signal', 'state']) {
        for (const directFirst of [true, false]) {
            it(`skips unchanged mixed effects (${kind}, direct first: ${directFirst})`, () => {
                const direct = kind === 'signal' ? signal(10) : state({ value: 10 });
                const read = kind === 'signal' ? direct : () => direct.value;
                const write = kind === 'signal' ? direct.set : value => (direct.value = value);
                const source = signal(0);
                const parity = computed(() => source() % 2);
                const cleanup = vi.fn();
                const values = [];
                effect(() => {
                    values.push(directFirst ? read() + parity() : parity() + read());
                    return cleanup;
                }, 1);

                for (let i = 1; i <= 100; i++) {
                    source.set(i * 2);
                    flushEffects();
                }
                expect(values).toEqual([10]);
                expect(cleanup).not.toHaveBeenCalled();

                write(20);
                flushEffects();
                source.set(201);
                flushEffects();
                expect(values).toEqual([10, 20, 21]);
                expect(cleanup).toHaveBeenCalledTimes(2);
            });
        }
    }

    for (const kind of ['signal', 'state']) {
        it(`rechecks a direct source changed while validating an equal computed (${kind})`, () => {
            const direct = kind === 'signal' ? signal(0) : state({ value: 0 });
            const read = kind === 'signal' ? direct : () => direct.value;
            const write = kind === 'signal' ? direct.set : value => (direct.value = value);
            const trigger = signal(false);
            const derived = computed(() => {
                if (trigger()) write(1);
                return 0;
            });
            const values = [];
            effect(() => {
                // Validate the direct source before pulling the computed that changes it.
                values.push(read() + derived());
            }, 1);
            expect(values).toEqual([0]);

            trigger.set(true);
            flushEffects();
            // Allow a write during the callback to schedule a follow-up run.
            flushEffects();

            expect(read()).toBe(1);
            expect(values.at(-1)).toBe(1);
        });
    }

    it('skips a live mixed computed getter and its downstream effect', () => {
        const direct = signal(10);
        const source = signal(0);
        const parity = computed(() => source() % 2);
        const getter = vi.fn(() => ({ value: direct() + parity() }));
        const mixed = computed(getter);
        const values = [];
        effect(() => values.push(mixed().value), 1);

        source.set(2);
        flushEffects();
        expect(getter).toHaveBeenCalledTimes(1);
        expect(values).toEqual([10]);

        direct.set(20);
        flushEffects();
        source.set(3);
        flushEffects();
        expect(getter).toHaveBeenCalledTimes(3);
        expect(values).toEqual([10, 20, 21]);
    });

    it('preserves method notifications even when the direct property value is unchanged', () => {
        const direct = state({ value: 10, notify() {} });
        const source = signal(0);
        const parity = computed(() => source() % 2);
        const getter = vi.fn(() => direct.value + parity());
        const mixed = computed(getter);
        const callback = vi.fn(() => {
            direct.value;
            parity();
            mixed();
        });
        effect(callback, 1);

        source.set(2);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(1);
        expect(getter).toHaveBeenCalledTimes(1);

        direct.notify();
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(2);
        expect(getter).toHaveBeenCalledTimes(2);
    });

    it('preserves direct signal change-and-revert notifications', () => {
        const direct = signal(10);
        const source = signal(0);
        const parity = computed(() => source() % 2);
        const callback = vi.fn(() => direct() + parity());
        effect(callback, 1);
        direct.set(20);
        direct.set(10);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('recovers from errors in computed sources while tracking direct dependencies', () => {
        const direct = signal(10);
        const source = signal(0);
        const parity = computed(() => {
            if (source() < 0) throw new Error('negative');
            return source() % 2;
        });
        const mixed = computed(() => parity() + direct());
        const values = [];
        effect(() => {
            try {
                values.push(mixed());
            } catch (error) {
                values.push(error.message);
            }
        }, 1);
        source.set(-1);
        flushEffects();
        source.set(2);
        flushEffects();
        direct.set(20);
        flushEffects();
        expect(values).toEqual([10, 'negative', 10, 20]);
    });

    it('updates conditional dependencies after a direct source changes', () => {
        const chooseA = signal(true);
        const a = signal(0);
        const b = signal(0);
        const parityA = computed(() => a() % 2);
        const parityB = computed(() => b() % 2);
        const values = [];
        effect(() => values.push(chooseA() ? parityA() : parityB()), 1);
        a.set(2);
        flushEffects();
        chooseA.set(false);
        flushEffects();
        a.set(3);
        flushEffects();
        b.set(1);
        flushEffects();
        expect(values).toEqual([0, 0, 1]);
    });
});
