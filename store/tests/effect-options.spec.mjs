import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, EffectOptions, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('effect — EffectOptions', () => {
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

    describe('EffectOptions enum', () => {
        it('exposes DEFERRED = 0 and EAGER = 1', () => {
            expect(EffectOptions.DEFERRED).toBe(0);
            expect(EffectOptions.EAGER).toBe(1);
        });
    });

    describe('EAGER mode', () => {
        it('runs synchronously during effect() call', () => {
            const subscriber = vi.fn();
            const s = signal(7);

            effect(() => subscriber(s()), EffectOptions.EAGER);

            // No await — must have already run.
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber).toHaveBeenCalledWith(7);
        });

        it('runs synchronously with state() source', () => {
            const subscriber = vi.fn();
            const store = state({ count: 3 });

            effect(() => subscriber(store.count), EffectOptions.EAGER);

            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber).toHaveBeenCalledWith(3);
        });

        it('runs synchronously with computed() source', () => {
            const subscriber = vi.fn();
            const s = signal(2);
            const doubled = computed(() => s() * 2);

            effect(() => subscriber(doubled()), EffectOptions.EAGER);

            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber).toHaveBeenCalledWith(4);
        });

        it('re-runs when a tracked signal changes', async () => {
            const subscriber = vi.fn();
            const s = signal(0);

            effect(() => subscriber(s()), EffectOptions.EAGER);
            expect(subscriber).toHaveBeenCalledTimes(1);

            s.set(1);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
            expect(subscriber).toHaveBeenLastCalledWith(1);

            s.set(2);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(3);
            expect(subscriber).toHaveBeenLastCalledWith(2);
        });

        it('does not re-run when an untracked dependency changes', async () => {
            const subscriber = vi.fn();
            const tracked = signal(0);
            const ignored = signal(0);

            effect(() => subscriber(tracked()), EffectOptions.EAGER);
            expect(subscriber).toHaveBeenCalledTimes(1);

            ignored.set(99);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('returns a dispose function that stops further runs', async () => {
            const subscriber = vi.fn();
            const s = signal(0);

            const dispose = effect(() => subscriber(s()), EffectOptions.EAGER);
            expect(subscriber).toHaveBeenCalledTimes(1);

            dispose();
            s.set(42);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('runs cleanup function before each re-run', async () => {
            const cleanup = vi.fn();
            const s = signal(0);

            effect(() => {
                s();
                return cleanup;
            }, EffectOptions.EAGER);

            expect(cleanup).toHaveBeenCalledTimes(0);

            s.set(1);
            await flushAll();
            expect(cleanup).toHaveBeenCalledTimes(1);

            s.set(2);
            await flushAll();
            expect(cleanup).toHaveBeenCalledTimes(2);
        });

        it('runs cleanup function on dispose', () => {
            const cleanup = vi.fn();
            const dispose = effect(() => cleanup, EffectOptions.EAGER);

            expect(cleanup).toHaveBeenCalledTimes(0);
            dispose();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('is tracked by the active scope and disposed with it', async () => {
            const subscriber = vi.fn();
            const s = signal(0);

            const innerScope = scope();
            setActiveScope(innerScope);
            effect(() => subscriber(s()), EffectOptions.EAGER);
            setActiveScope(testScope);

            expect(subscriber).toHaveBeenCalledTimes(1);

            innerScope(); // dispose

            s.set(1);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });
    });

    describe('DEFERRED mode (explicit)', () => {
        it('behaves identically to omitting the second argument', async () => {
            const a = vi.fn();
            const b = vi.fn();
            const s = signal(0);

            effect(() => a(s()));
            effect(() => b(s()), EffectOptions.DEFERRED);

            // Neither runs sync.
            expect(a).toHaveBeenCalledTimes(0);
            expect(b).toHaveBeenCalledTimes(0);

            await flushAll();
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);

            s.set(1);
            await flushAll();
            expect(a).toHaveBeenCalledTimes(2);
            expect(b).toHaveBeenCalledTimes(2);
        });
    });

    describe('mixed EAGER and DEFERRED', () => {
        it('only the EAGER one runs synchronously, both react to changes', async () => {
            const eagerCb = vi.fn();
            const deferredCb = vi.fn();
            const s = signal(0);

            effect(() => deferredCb(s()));
            effect(() => eagerCb(s()), EffectOptions.EAGER);

            expect(eagerCb).toHaveBeenCalledTimes(1);
            expect(deferredCb).toHaveBeenCalledTimes(0);

            await flushAll();
            expect(eagerCb).toHaveBeenCalledTimes(1);
            expect(deferredCb).toHaveBeenCalledTimes(1);

            s.set(1);
            await flushAll();
            expect(eagerCb).toHaveBeenCalledTimes(2);
            expect(deferredCb).toHaveBeenCalledTimes(2);
        });
    });

    describe('error handling — documented semantics', () => {
        it('EAGER: first-run errors propagate synchronously to the caller', () => {
            expect(() =>
                effect(() => {
                    throw new Error('boom');
                }, EffectOptions.EAGER)
            ).toThrow(/boom/);
        });

        it('EAGER: caller can catch and recover with try/catch', () => {
            let caught;
            try {
                effect(() => {
                    throw new Error('boom');
                }, EffectOptions.EAGER);
            } catch (e) {
                caught = e;
            }
            expect(caught).toBeInstanceOf(Error);
            expect(caught.message).toBe('boom');
        });

        it('DEFERRED: first-run errors are caught by the flush loop and logged', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            // Must not throw to caller.
            expect(() =>
                effect(() => {
                    throw new Error('deferred-boom');
                })
            ).not.toThrow();

            await flushAll();

            const errs = errSpy.mock.calls.flat();
            errSpy.mockRestore();
            expect(errs.some(e => e instanceof Error && e.message === 'deferred-boom')).toBe(true);
        });
    });
});
