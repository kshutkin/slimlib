import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock esm-env to simulate production mode (DEV = false)
vi.mock('esm-env', () => ({
    DEV: false,
    BROWSER: false,
}));

// Import after mocking - these will use the mocked DEV = false
import {
    debugConfig,
    effect,
    flushEffects,
    SUPPRESS_EFFECT_GC_WARNING,
    scope,
    setActiveScope,
    state,
    WARN_ON_UNTRACKED_EFFECT,
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

describe('production mode (DEV = false)', () => {
    /** @type {import('vitest').MockInstance<(message?: any, ...optionalParams: any[]) => void>} */
    let consoleWarnSpy;
    /** @type {ReturnType<typeof scope>} */
    let testScope;

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        debugConfig(0);
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
        consoleWarnSpy.mockRestore();
        debugConfig(0);
    });

    describe('WARN_ON_WRITE_IN_COMPUTED', () => {
        it('should not warn even when flag is enabled in production mode', async () => {
            debugConfig(WARN_ON_WRITE_IN_COMPUTED);

            const { signal, computed } = await import('../src/index.js');
            const counter = signal(0);
            const other = signal(0);

            const comp = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp();

            // No warning in production mode
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe('SUPPRESS_EFFECT_GC_WARNING', () => {
        /**
         * Helper to aggressively trigger GC and wait for finalization callbacks.
         */
        async function triggerGCAndWait() {
            for (let i = 0; i < 5; i++) {
                allocateMemory();
                forceGC();
                await flushAll();
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        it('should not warn when effect is GCd in production mode (no FinalizationRegistry)', async () => {
            // Clear active scope so the effect can be GC'd
            setActiveScope(undefined);

            // Create an effect that will be GC'd
            (() => {
                const store = state({ count: 0 });
                effect(() => {
                    store.count;
                });
            })();

            setActiveScope(testScope);

            await flushAll();

            // Force GC
            await triggerGCAndWait();

            // No warning in production mode - FinalizationRegistry is not created
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('effect dispose works normally in production mode', async () => {
            const store = state({ count: 0 });
            let runs = 0;

            const dispose = effect(() => {
                runs++;
                store.count;
            });

            await flushAll();
            expect(runs).toBe(1);

            store.count = 1;
            await flushAll();
            expect(runs).toBe(2);

            // Dispose should work
            dispose();

            store.count = 2;
            await flushAll();
            // Effect should not run after dispose
            expect(runs).toBe(2);

            // No warnings
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe('WARN_ON_UNTRACKED_EFFECT', () => {
        it('should not warn even when flag is enabled in production mode', async () => {
            debugConfig(WARN_ON_UNTRACKED_EFFECT);

            // Clear active scope
            setActiveScope(undefined);

            const store = state({ count: 0 });
            const dispose = effect(() => {
                store.count;
            });

            await flushAll();

            // No warning in production mode
            expect(consoleWarnSpy).not.toHaveBeenCalled();

            dispose();
            setActiveScope(testScope);
        });

        it('effects work normally without active scope in production mode', async () => {
            setActiveScope(undefined);

            const store = state({ count: 0 });
            let runs = 0;

            const dispose = effect(() => {
                runs++;
                store.count;
            });

            await flushAll();
            expect(runs).toBe(1);

            store.count = 5;
            await flushAll();
            expect(runs).toBe(2);

            dispose();
            setActiveScope(testScope);

            // No warnings
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe('combined flags', () => {
        it('all debug flags should have no effect in production mode', async () => {
            // Enable all flags
            debugConfig(WARN_ON_WRITE_IN_COMPUTED | WARN_ON_UNTRACKED_EFFECT | SUPPRESS_EFFECT_GC_WARNING);

            setActiveScope(undefined);

            const store = state({ count: 0 });

            // Create effect without scope (would warn with WARN_ON_UNTRACKED_EFFECT in dev)
            const dispose = effect(() => {
                store.count;
            });

            await flushAll();

            dispose();
            setActiveScope(testScope);

            // No warnings in production mode
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });
});
