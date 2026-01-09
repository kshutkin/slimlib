import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    computed,
    debugConfig,
    effect,
    flushEffects,
    SUPPRESS_EFFECT_GC_WARNING,
    scope,
    setActiveScope,
    signal,
    state,
    WARN_ON_WRITE_IN_COMPUTED,
} from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

/**
 * Force garbage collection
 * Requires --expose-gc flag to be passed to Node.js
 */
function forceGC() {
    if (typeof global.gc === 'function') {
        global.gc();
    } else {
        throw new Error('GC is not exposed. Run with --expose-gc flag.');
    }
}

/**
 * Allocate memory to help trigger GC
 */
function allocateMemory() {
    const arrays = [];
    for (let i = 0; i < 100; i++) {
        arrays.push(new Array(10000).fill(i));
    }
    return arrays;
}

describe('debugConfig', () => {
    /** @type {import('vitest').MockInstance<(message?: any, ...optionalParams: any[]) => void>} */
    let consoleWarnSpy;
    /** @type {ReturnType<typeof scope>} */
    let testScope;

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Reset configuration before each test
        debugConfig(0);
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
        consoleWarnSpy.mockRestore();
        // Reset configuration after each test
        debugConfig(0);
    });

    describe('WARN_ON_WRITE_IN_COMPUTED', () => {
        it('should not warn by default when writing to signal inside computed', () => {
            const counter = signal(0);
            const other = signal(0);

            const comp = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn when enabled and writing to signal inside computed', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const other = signal(0);

            const comp = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to signal inside a computed'));
        });

        it('should warn when enabled and writing to state inside computed', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const obj = state({ value: 0 });

            const comp = computed(() => {
                obj.value = counter() + 1;
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should not warn when writing inside an effect', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const other = signal(0);

            const dispose = effect(() => {
                other.set(counter() + 1);
            });

            expect(consoleWarnSpy).not.toHaveBeenCalled();

            dispose();
        });

        it('should not warn when writing outside of computed/effect', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            counter.set(1);

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn on state property deletion inside computed', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            /** @type {{ value: number, toDelete?: number }} */
            const obj = state({ value: 0, toDelete: 1 });

            const comp = computed(() => {
                delete obj.toDelete;
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should warn on Object.defineProperty inside computed', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const obj = state({ value: 0 });

            const comp = computed(() => {
                Object.defineProperty(obj, 'newProp', { value: 42, writable: true, configurable: true, enumerable: true });
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should be able to disable warnings after enabling them', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const other = signal(0);

            const comp1 = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp1();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

            // Disable warnings
            debugConfig(0);
            consoleWarnSpy.mockClear();

            const comp2 = computed(() => {
                other.set(counter() + 2);
                return counter();
            });

            comp2();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn multiple times for multiple writes inside same computed', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const other1 = signal(0);
            const other2 = signal(0);

            const comp = computed(() => {
                other1.set(counter() + 1);
                other2.set(counter() + 2);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
        });

        it('should warn for nested computed writes', () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const counter = signal(0);
            const other = signal(0);

            const inner = computed(() => {
                other.set(counter() + 1);
                return counter() * 2;
            });

            const outer = computed(() => {
                return inner() + 1;
            });

            outer();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('SUPPRESS_EFFECT_GC_WARNING', () => {
        /**
         * Helper to aggressively trigger GC and wait for finalization callbacks.
         * FinalizationRegistry callbacks are non-deterministic, so we need multiple attempts.
         */
        async function triggerGCAndWait() {
            for (let i = 0; i < 10; i++) {
                allocateMemory();
                forceGC();
                await flushAll();
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            // Extra wait for finalization callbacks to be scheduled and run
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        it("should warn by default when effect is GC'd without being disposed", async () => {
            // Clear active scope so the effect's dispose function isn't tracked
            // This allows the dispose function (and its gcToken) to be GC'd
            setActiveScope(undefined);

            // Create an effect in an isolated scope that will be GC'd
            (() => {
                const store = state({ count: 0 });
                effect(() => {
                    store.count;
                });
                // Don't call dispose - let it be GC'd
            })();

            // Restore test scope
            setActiveScope(testScope);

            await flushAll();

            // Force GC multiple times and wait for finalization callbacks
            await triggerGCAndWait();

            // The warning should have been triggered
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Effect was garbage collected without being disposed'));
        });

        it('should not warn when effect is properly disposed', async () => {
            const store = state({ count: 0 });
            const dispose = effect(() => {
                store.count;
            });

            await flushAll();

            // Properly dispose the effect
            dispose();

            // Force GC multiple times and wait
            await triggerGCAndWait();

            // No warning should have been triggered
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should not warn when effect is disposed by scope', async () => {
            const innerScope = scope();
            setActiveScope(innerScope);

            const store = state({ count: 0 });
            effect(() => {
                store.count;
            });

            setActiveScope(testScope);

            await flushAll();

            // Dispose the scope (which disposes the effect)
            innerScope();

            // Force GC multiple times and wait
            await triggerGCAndWait();

            // No warning should have been triggered
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should not warn when SUPPRESS_EFFECT_GC_WARNING is set', async () => {
            debugConfig(SUPPRESS_EFFECT_GC_WARNING);

            // Clear active scope so the effect's dispose function isn't tracked
            setActiveScope(undefined);

            // Create an effect that will be GC'd without being disposed
            (() => {
                const store = state({ count: 0 });
                effect(() => {
                    store.count;
                });
            })();

            // Restore test scope
            setActiveScope(testScope);

            await flushAll();

            // Force GC multiple times and wait
            await triggerGCAndWait();

            // No warning should have been triggered because it's suppressed
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should include stack trace in warning message', async () => {
            // Clear active scope so the effect's dispose function isn't tracked
            setActiveScope(undefined);

            // Create an effect that will be GC'd
            (() => {
                const store = state({ count: 0 });
                effect(() => {
                    store.count;
                });
            })();

            // Restore test scope
            setActiveScope(testScope);

            await flushAll();

            // Force GC multiple times and wait for finalization callbacks
            await triggerGCAndWait();

            // The warning should include stack trace info
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Effect was created at:'));
        });
    });
});
