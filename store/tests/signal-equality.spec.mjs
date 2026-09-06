import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal } from '../src/index.js';

describe('signal equality', () => {
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

    it('retains the previous value and skips consumers for equal writes', () => {
        const initial = { id: 1 };
        const equals = vi.fn((a, b) => a.id === b.id);
        const source = signal(initial, equals);
        const getter = vi.fn(() => source().id);
        const derived = computed(getter);
        const callback = vi.fn(() => derived());
        effect(callback, 1);
        source.set({ id: 1 });
        flushEffects();
        expect(source()).toBe(initial);
        expect(equals).toHaveBeenCalledWith(initial, { id: 1 });
        expect(getter).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledTimes(1);
        source.set({ id: 2 });
        flushEffects();
        expect(derived()).toBe(2);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    for (const live of [false, true]) {
        for (const initial of [1, undefined, null, { count: 1 }]) {
            it(`honors always-notify equality for ${typeof initial} (live: ${live})`, () => {
                const source = signal(initial, () => false);
                const getter = vi.fn(() => source());
                const derived = computed(getter, () => false);
                const downstream = vi.fn(() => derived());
                const chained = computed(downstream);
                if (live) effect(() => chained(), 1);
                chained();
                source.set(initial);
                flushEffects();
                chained();
                expect(getter).toHaveBeenCalledTimes(2);
                expect(downstream).toHaveBeenCalledTimes(2);
            });
        }
    }

    it('notifies direct and mixed effects even for identical writes', () => {
        const source = signal(1, () => false);
        const stable = computed(() => source() % 2);
        const direct = vi.fn(() => source());
        const mixed = vi.fn(() => source() + stable());
        effect(direct, 1);
        effect(mixed, 1);
        source.set(1);
        flushEffects();
        expect(direct).toHaveBeenCalledTimes(2);
        expect(mixed).toHaveBeenCalledTimes(2);
    });

    it('preserves computed equality cutoff after an accepted signal write', () => {
        const source = signal(1, () => false);
        const getter = vi.fn(() => source());
        const derived = computed(getter);
        const callback = vi.fn(() => derived());
        effect(callback, 1);
        source.set(1);
        flushEffects();
        expect(getter).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    for (const equals of [undefined, Object.is, () => false]) {
        it(`handles reverted primitive writes (${equals?.name ?? 'default'})`, () => {
            const source = signal(1, equals);
            const getter = vi.fn(() => source());
            const derived = computed(getter);
            derived();
            source.set(2);
            source.set(1);
            expect(derived()).toBe(1);
            expect(getter).toHaveBeenCalledTimes(equals === undefined || equals === Object.is ? 1 : 2);
        });
    }

    it('keeps Object.is semantics by default', () => {
        const source = signal(Number.NaN);
        const callback = vi.fn(() => source());
        effect(callback, 1);
        source.set(Number.NaN);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(1);
        source.set(0);
        flushEffects();
        source.set(-0);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(3);
        expect(Object.is(source(), -0)).toBe(true);
    });

    it('uses custom equality when primitive writes leave an equivalent value', () => {
        const equals = vi.fn((a, b) => a % 2 === b % 2);
        const source = signal(1, equals);
        const getter = vi.fn(() => source());
        const derived = computed(getter);
        expect(derived()).toBe(1);
        source.set(2);
        source.set(3);
        expect(derived()).toBe(1);
        expect(source()).toBe(3);
        expect(getter).toHaveBeenCalledTimes(1);
        expect(equals).toHaveBeenLastCalledWith(1, 3);
        source.set(4);
        expect(derived()).toBe(4);
        expect(getter).toHaveBeenCalledTimes(2);
    });

    it('keeps object notifications even when custom equality considers the final value equivalent', () => {
        const source = signal({ id: 1 }, (a, b) => a.id === b.id);
        const getter = vi.fn(() => source().id);
        const derived = computed(getter);
        derived();
        source.set({ id: 2 });
        source.set({ id: 1 });
        expect(derived()).toBe(1);
        expect(getter).toHaveBeenCalledTimes(2);
    });

    it('leaves the signal unchanged when equality throws', () => {
        const source = signal(1, () => {
            throw new Error('comparison failed');
        });
        expect(() => source.set(2)).toThrow('comparison failed');
        expect(source()).toBe(1);
    });
});
