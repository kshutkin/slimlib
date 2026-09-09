import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentComputing } from '../src/core.js';
import { computed, effect, flushEffects, scope, setActiveScope, signal, state, unwrapValue } from '../src/index.js';

describe('source read coalescing', () => {
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

    for (const kind of ['signal', 'state', 'computed']) {
        it(`coalesces consecutive ${kind} reads`, () => {
            const source = kind === 'state' ? state({ value: 1 }) : signal(1);
            const read = kind === 'computed' ? computed(source) : kind === 'signal' ? source : () => source.value;
            let node;
            const sum = computed(() => {
                node = currentComputing;
                let value = 0;
                for (let i = 0; i < 1000; i++) value += read();
                return value;
            });
            expect(sum()).toBe(1000);
            expect(node.$_sources).toHaveLength(1);
            if (kind !== 'state') source.set(2);
            else source.value = 2;
            expect(sum()).toBe(2000);
            expect(node.$_sources).toHaveLength(1);
        });
    }

    for (const kind of ['signal', 'state', 'computed']) {
        it(`detaches a replaced source before a coalesced ${kind} read returns`, () => {
            const toggle = signal(false);
            const source = kind === 'state' ? state({ value: 1 }) : signal(1);
            const read = kind === 'computed' ? computed(source) : kind === 'signal' ? source : () => source.value;
            const obsolete = signal(1);
            let runs = 0;
            effect(() => {
                ++runs;
                const switched = toggle();
                read();
                if (switched) {
                    read();
                    // This source belonged to the old branch and must already be detached.
                    obsolete.set(2);
                } else {
                    obsolete();
                }
            }, 1);
            expect(runs).toBe(1);

            toggle.set(true);
            flushEffects();
            // Expose any spurious rerun queued by the obsolete source's write.
            flushEffects();

            expect(obsolete()).toBe(2);
            expect(runs).toBe(2);
        });
    }

    it('keeps separate observations when a signal is written between reads', () => {
        const source = signal(1);
        let node;
        const value = computed(() => {
            node = currentComputing;
            const before = source();
            source.set(2);
            return before + source();
        });
        expect(value()).toBe(3);
        expect(node.$_sources).toHaveLength(2);
        expect(node.$_sources.map(entry => entry.$_storedValue)).toEqual([1, 2]);
    });

    it('keeps computed observations separate when a source changes between reads', () => {
        const source = signal(1);
        const derived = computed(() => source() * 2);
        let node;
        const result = computed(() => {
            node = currentComputing;
            const before = derived();
            source.set(2);
            return before + derived();
        });
        expect(result()).toBe(6);
        expect(node.$_sources).toHaveLength(2);
    });

    it('keeps separate observations when raw state changes without notification', () => {
        const source = state({ value: 1 });
        let node;
        const value = computed(() => {
            node = currentComputing;
            const before = source.value;
            unwrapValue(source).value = 2;
            return before + source.value;
        });
        expect(value()).toBe(3);
        expect(node.$_sources.map(entry => entry.$_storedValue)).toEqual([1, 2]);
    });

    for (const live of [false, true]) {
        it(`handles dependency insertion (live: ${live})`, () => {
            const toggle = signal(false);
            const sources = Array.from({ length: 32 }, () => signal(1));
            const extra = signal(10);
            const sum = computed(() => {
                const includeExtra = toggle();
                let value = 0;
                for (let i = 0; i < 16; i++) value += sources[i]();
                if (includeExtra) value += extra();
                for (let i = 16; i < 32; i++) value += sources[i]();
                return value;
            });
            if (live)
                effect(() => {
                    sum();
                }, 1);
            expect(sum()).toBe(32);
            toggle.set(true);
            flushEffects();
            expect(sum()).toBe(42);
            toggle.set(false);
            flushEffects();
            expect(sum()).toBe(32);
            extra.set(100);
            flushEffects();
            expect(sum()).toBe(32);
            sources[31].set(2);
            flushEffects();
            expect(sum()).toBe(33);
        });
    }

    it('retains a non-consecutive repeated source when a branch is removed', () => {
        const toggle = signal(false);
        const a = signal(1);
        const b = signal(2);
        const c = signal(3);
        const values = [];
        effect(() => {
            const switched = toggle();
            const first = a();
            values.push(switched ? first + c() : first + b() + a());
        }, 1);
        toggle.set(true);
        flushEffects();
        b.set(10);
        flushEffects();
        a.set(2);
        flushEffects();
        expect(values).toEqual([4, 4, 5]);
    });

    it('preserves dependencies across nested computations and thrown errors', () => {
        const mode = signal(0);
        const oldSources = Array.from({ length: 12 }, () => signal(1));
        const newSources = Array.from({ length: 12 }, () => signal(2));
        const child = computed(() => newSources.reduce((sum, read) => sum + read(), 0));
        let node;
        const parent = computed(() => {
            node = currentComputing;
            const currentMode = mode();
            if (currentMode === 0) return oldSources.reduce((sum, read) => sum + read(), 0);
            const result = child();
            if (currentMode === 1) throw new Error('retry');
            return result + newSources.reduce((sum, read) => sum + read(), 0);
        });
        effect(() => {
            try {
                parent();
            } catch {}
        }, 1);
        expect(parent()).toBe(12);
        mode.set(1);
        expect(() => parent()).toThrow('retry');
        mode.set(2);
        expect(parent()).toBe(48);
        expect(new Set(node.$_sources).size).toBe(node.$_sources.length);
        newSources[0].set(3);
        expect(parent()).toBe(50);
        oldSources[0].set(100);
        expect(parent()).toBe(50);
    });
});
