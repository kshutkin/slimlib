import { setImmediate } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, EffectOptions, effect, flushEffects, scope, setActiveScope, setScheduler, signal, state } from '../src/index.js';

function createFailedEffect(value, queueBeforeThrow) {
    const payload = { runs: 0 };
    const callback = () => {
        payload.runs++;
        const current = value();
        if (queueBeforeThrow && current === 0) value.set(1);
        throw undefined;
    };
    const refs = { callback: new WeakRef(callback), payload: new WeakRef(payload) };
    try {
        effect(callback, EffectOptions.EAGER);
    } catch {
        // Retain only WeakRefs after setup fails.
    }
    expect(payload.runs).toBe(1);
    return refs;
}

describe('eager effect setup failure', () => {
    let owner;

    beforeEach(() => {
        owner = scope();
        setActiveScope(owner);
    });

    afterEach(() => {
        owner();
        setActiveScope(undefined);
        setScheduler(queueMicrotask);
        vi.restoreAllMocks();
    });

    describe.each([
        ['microtask', queueMicrotask],
        ['synchronous', callback => callback()],
    ])('%s scheduler', (_name, scheduler) => {
        beforeEach(() => setScheduler(scheduler));

        describe.each([true, false])('scoped: %s', scoped => {
            beforeEach(() => {
                if (!scoped) setActiveScope(undefined);
            });

            it.each([
                [
                    'signal',
                    () => {
                        const value = signal(0);
                        return { read: value, write: value.set };
                    },
                ],
                [
                    'state',
                    () => {
                        const value = state({ count: 0 });
                        return {
                            read: () => value.count,
                            write: count => {
                                value.count = count;
                            },
                        };
                    },
                ],
                [
                    'computed',
                    () => {
                        const value = signal(0);
                        return { read: computed(() => value() * 2), write: value.set };
                    },
                ],
            ])('unsubscribes from a shared %s without stopping other effects', (_source, createSource) => {
                const { read, write } = createSource();
                const healthy = vi.fn(() => read());
                const stopHealthy = effect(healthy, EffectOptions.EAGER);
                const failure = new Error('Setup failed');
                const failed = vi.fn(() => {
                    if (read() === 0) throw failure;
                });
                let caught;

                try {
                    effect(failed, EffectOptions.EAGER);
                } catch (error) {
                    caught = error;
                }

                expect(caught).toBe(failure);
                write(1);
                flushEffects();
                write(2);
                flushEffects();

                expect(failed).toHaveBeenCalledTimes(1);
                expect(healthy).toHaveBeenCalledTimes(3);
                stopHealthy();
            });
        });

        it('keeps an eager effect subscribed after a later run fails', () => {
            const value = signal(0);
            const failure = new Error('Later run failed');
            const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
            const callback = vi.fn(() => {
                if (value() === 1) throw failure;
            });
            effect(callback, EffectOptions.EAGER);

            value.set(1);
            flushEffects();
            expect(errors).toHaveBeenCalledWith(failure);

            value.set(2);
            flushEffects();
            expect(callback).toHaveBeenCalledTimes(3);
        });
    });

    it.each([true, false])('skips an effect queued before setup throws (scoped: %s)', scoped => {
        if (!scoped) setActiveScope(undefined);
        const scheduled = [];
        setScheduler(callback => scheduled.push(callback));
        const value = signal(0);
        const failure = new Error('Setup failed after scheduling');
        const callback = vi.fn(() => {
            if (value() === 0) {
                value.set(1);
                throw failure;
            }
        });

        expect(() => effect(callback, EffectOptions.EAGER)).toThrow(failure);
        expect(scheduled).toHaveLength(1);
        scheduled[0]();
        flushEffects();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, 'Setup failed'])('preserves a non-Error throw (%s) and unsubscribes', failure => {
        const value = signal(0);
        const callback = vi.fn(() => {
            if (value() === 0) throw failure;
        });
        const caught = [];

        try {
            effect(callback, EffectOptions.EAGER);
        } catch (error) {
            caught.push(error);
        }

        expect(caught).toEqual([failure]);
        value.set(1);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('releases the failed callback while its scope remains live (queued: %s)', async queued => {
        const value = signal(0);
        const observed = [];
        effect(() => {
            observed.push(value());
        }, EffectOptions.EAGER);
        const refs = createFailedEffect(value, queued);
        flushEffects();

        for (let i = 0; i < 10; i++) {
            await setImmediate();
            global.gc();
            if (refs.callback.deref() === undefined && refs.payload.deref() === undefined) break;
        }

        expect(refs.callback.deref()).toBeUndefined();
        expect(refs.payload.deref()).toBeUndefined();
        value.set(2);
        flushEffects();
        expect(observed.at(-1)).toBe(2);
    });

    it('disposes neighboring effects after multiple eager setups fail', () => {
        const value = signal(0);
        const before = vi.fn();
        const after = vi.fn();
        const callback = vi.fn(() => {
            value();
            return before;
        });
        effect(callback, EffectOptions.EAGER);
        createFailedEffect(value, false);
        createFailedEffect(value, false);
        effect(() => {
            value();
            return after;
        }, EffectOptions.EAGER);

        owner();

        expect(before).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
        value.set(1);
        flushEffects();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('keeps effects created during failed setup registered with the scope', () => {
        const value = signal(0);
        const cleanup = vi.fn();
        const failure = new Error('Outer setup failed');
        const nested = vi.fn(() => {
            value();
            return cleanup;
        });

        expect(() =>
            effect(() => {
                effect(nested, EffectOptions.EAGER);
                throw failure;
            }, EffectOptions.EAGER)
        ).toThrow(failure);

        value.set(1);
        flushEffects();
        expect(nested).toHaveBeenCalledTimes(2);
        expect(cleanup).toHaveBeenCalledTimes(1);

        owner();
        expect(cleanup).toHaveBeenCalledTimes(2);
        value.set(2);
        flushEffects();
        expect(nested).toHaveBeenCalledTimes(2);
    });

    it('preserves the error when the eager callback disposes its own scope before throwing', () => {
        const cleanup = vi.fn();
        const failure = new Error('Setup failed after scope disposal');
        effect(() => cleanup, EffectOptions.EAGER);
        let caught;

        try {
            effect(() => {
                owner();
                throw failure;
            }, EffectOptions.EAGER);
        } catch (error) {
            caught = error;
        }

        expect(caught).toBe(failure);
        expect(cleanup).toHaveBeenCalledTimes(1);
        owner();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
