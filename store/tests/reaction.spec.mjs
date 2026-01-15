import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, state, untracked } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

/**
 * A MobX-style reaction helper that watches a data function and calls an effect
 * when the tracked value changes.
 * 
 * @template T
 * @param {() => T} dataFn - Function that returns the tracked value
 * @param {(newValue: T, oldValue: T | undefined) => void} effectFn - Function called when value changes
 * @param {object} [options] - Options
 * @param {boolean} [options.fireImmediately] - Whether to fire immediately on creation
 * @param {(a: T, b: T | undefined) => boolean} [options.equals] - Custom equality function
 * @param {(error: unknown) => void} [options.onError] - Error handler
 * @param {(fn: () => void) => void} [options.scheduler] - Custom scheduler
 * @param {boolean} [options.once] - Whether to dispose after first reaction
 * @returns {() => void} Dispose function
 */
function reaction(dataFn, effectFn, options = {}) {
    const {
        scheduler = (fn) => fn(),
        equals = Object.is,
        onError,
        once = false,
        fireImmediately = false,
    } = options;

    let prevValue;
    let version = 0;

    const tracked = computed(() => {
        try {
            return dataFn();
        } catch (error) {
            untracked(() => onError?.(error));
            return prevValue;
        }
    });

    const dispose = effect(() => {
        const current = tracked();
        if (!fireImmediately && !version) {
            prevValue = current;
        }
        version++;
        if (equals(current, prevValue)) return;
        const oldValue = prevValue;
        prevValue = current;
        untracked(() =>
            scheduler(() => {
                try {
                    effectFn(current, oldValue);
                } catch (error) {
                    onError?.(error);
                } finally {
                    if (once) {
                        if (fireImmediately && version > 1) dispose();
                        else if (!fireImmediately && version > 0) dispose();
                    }
                }
            })
        );
    });

    return dispose;
}

describe('reaction pattern', () => {
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

    describe('basic functionality', () => {
        it('should react to changes', async () => {
            const store = state({ value: 0 });
            /** @type {Array<{new: number, old: number | undefined}>} */
            const reactions = [];

            reaction(
                () => store.value,
                (newVal, oldVal) => {
                    reactions.push({ new: newVal, old: oldVal });
                }
            );

            await flushAll();
            expect(reactions).toEqual([]);

            store.value = 1;
            await flushAll();
            expect(reactions).toEqual([{ new: 1, old: 0 }]);

            store.value = 2;
            await flushAll();
            expect(reactions).toEqual([
                { new: 1, old: 0 },
                { new: 2, old: 1 }
            ]);
        });

        it('should fire immediately when option set', async () => {
            const store = state({ value: 5 });
            /** @type {number[]} */
            const seen = [];

            reaction(
                () => store.value,
                (val) => seen.push(val),
                { fireImmediately: true }
            );

            await flushAll();
            expect(seen).toEqual([5]);

            store.value = 10;
            await flushAll();
            expect(seen).toEqual([5, 10]);
        });

        it('should dispose correctly', async () => {
            const store = state({ value: 0 });
            let reactionCount = 0;

            const dispose = reaction(
                () => store.value,
                () => reactionCount++
            );

            await flushAll();
            store.value = 1;
            await flushAll();
            expect(reactionCount).toBe(1);

            dispose();

            store.value = 2;
            await flushAll();
            expect(reactionCount).toBe(1);
        });
    });

    describe('issue 48 regression - dynamic reaction disposal', () => {
        it('should handle creating and disposing reactions dynamically', async () => {
            const source = state({ value: 0 });
            let disposeInner;

            reaction(
                () => source.value,
                (val) => {
                    if (val === 1) {
                        disposeInner = reaction(
                            () => source.value,
                            () => { }
                        );
                    } else if (val === 2) {
                        disposeInner?.();
                    }
                }
            );

            await flushAll();
            
            source.value = 1; // Creates inner reaction
            await flushAll();
            
            source.value = 2; // Disposes inner reaction
            await flushAll();
            
            source.value = 3; // Should work without errors
            await flushAll();
            // Test passes if no errors thrown
        });

        it('should handle nested reaction creation', async () => {
            const store = state({ outer: 0, inner: 0 });
            /** @type {string[]} */
            const log = [];
            /** @type {(() => void) | undefined} */
            let innerDispose;

            reaction(
                () => store.outer,
                (val) => {
                    log.push(`outer: ${val}`);
                    
                    // Dispose previous inner reaction if exists
                    innerDispose?.();
                    
                    // Create new inner reaction
                    innerDispose = reaction(
                        () => store.inner,
                        (innerVal) => {
                            log.push(`inner(${val}): ${innerVal}`);
                        }
                    );
                }
            );

            await flushAll();
            
            store.outer = 1;
            await flushAll();
            expect(log).toContain('outer: 1');
            
            store.inner = 1;
            await flushAll();
            expect(log).toContain('inner(1): 1');
            
            store.outer = 2; // Should dispose old inner and create new
            await flushAll();
            expect(log).toContain('outer: 2');
            
            store.inner = 2;
            await flushAll();
            expect(log).toContain('inner(2): 2');
            
            // Cleanup
            innerDispose?.();
        });

        it('should handle rapid creation and disposal', async () => {
            const store = state({ trigger: 0 });
            const disposers = [];

            reaction(
                () => store.trigger,
                (val) => {
                    // Create a new reaction each time
                    const dispose = reaction(
                        () => store.trigger,
                        () => { }
                    );
                    disposers.push(dispose);
                    
                    // Dispose after a few iterations
                    if (disposers.length > 3) {
                        disposers.shift()?.();
                    }
                }
            );

            await flushAll();
            
            for (let i = 1; i <= 10; i++) {
                store.trigger = i;
                await flushAll();
            }
            
            // Cleanup remaining
            for (const dispose of disposers) {
                dispose();
            }
            // Test passes if no errors thrown
        });
    });

    describe('options', () => {
        it('should use custom equals function', async () => {
            const store = state({ obj: { id: 1, name: 'test' } });
            /** @type {Array<{id: number, name: string}>} */
            const reactions = [];

            reaction(
                () => store.obj,
                (val) => reactions.push(val),
                { equals: (a, b) => a?.id === b?.id }
            );

            await flushAll();
            
            // Same id, should not trigger
            store.obj = { id: 1, name: 'changed' };
            await flushAll();
            expect(reactions.length).toBe(0);
            
            // Different id, should trigger
            store.obj = { id: 2, name: 'new' };
            await flushAll();
            expect(reactions.length).toBe(1);
            expect(reactions[0]).toEqual({ id: 2, name: 'new' });
        });

        it('should handle errors with onError', async () => {
            const store = state({ value: 0 });
            /** @type {unknown[]} */
            const errors = [];

            reaction(
                () => {
                    if (store.value === 2) throw new Error('data error');
                    return store.value;
                },
                (val) => {
                    if (val === 3) throw new Error('effect error');
                },
                { onError: (e) => errors.push(e) }
            );

            await flushAll();
            
            store.value = 1;
            await flushAll();
            expect(errors.length).toBe(0);
            
            store.value = 2; // Error in data function
            await flushAll();
            expect(errors.length).toBe(1);
            
            store.value = 3; // Error in effect function
            await flushAll();
            expect(errors.length).toBe(2);
        });

        it('should fire once when once option is set', async () => {
            const store = state({ value: 0 });
            let reactionCount = 0;

            reaction(
                () => store.value,
                () => reactionCount++,
                { once: true }
            );

            await flushAll();
            expect(reactionCount).toBe(0);
            
            store.value = 1;
            await flushAll();
            expect(reactionCount).toBe(1);
            
            store.value = 2;
            await flushAll();
            expect(reactionCount).toBe(1); // Should not fire again
        });

        it('should use custom scheduler', async () => {
            const store = state({ value: 0 });
            /** @type {Array<() => void>} */
            const scheduled = [];
            let reactionCount = 0;

            reaction(
                () => store.value,
                () => reactionCount++,
                { scheduler: (fn) => scheduled.push(fn) }
            );

            await flushAll();
            
            store.value = 1;
            await flushAll();
            
            expect(reactionCount).toBe(0);
            expect(scheduled.length).toBe(1);
            
            // Execute scheduled work
            scheduled[0]();
            expect(reactionCount).toBe(1);
        });
    });

    describe('computed dependency tracking', () => {
        it('should track computed values in data function', async () => {
            const store = state({ a: 1, b: 2 });
            const sum = computed(() => store.a + store.b);
            /** @type {number[]} */
            const reactions = [];

            reaction(
                () => sum(),
                (val) => reactions.push(val)
            );

            await flushAll();
            expect(reactions).toEqual([]);
            
            store.a = 5;
            await flushAll();
            expect(reactions).toEqual([7]);
            
            store.b = 10;
            await flushAll();
            expect(reactions).toEqual([7, 15]);
        });

        it('should handle conditional dependencies', async () => {
            const store = state({ flag: true, a: 1, b: 2 });
            /** @type {number[]} */
            const reactions = [];

            reaction(
                () => store.flag ? store.a : store.b,
                (val) => reactions.push(val)
            );

            await flushAll();
            
            store.a = 10;
            await flushAll();
            expect(reactions).toEqual([10]);
            
            store.b = 20; // Not tracked because flag is true
            await flushAll();
            expect(reactions).toEqual([10]);
            
            store.flag = false;
            await flushAll();
            expect(reactions).toEqual([10, 20]);
            
            store.a = 100; // Not tracked anymore
            await flushAll();
            expect(reactions).toEqual([10, 20]);
            
            store.b = 200;
            await flushAll();
            expect(reactions).toEqual([10, 20, 200]);
        });
    });
});