/**
 * Tests for the runner's activeScope save/restore behavior.
 *
 * The effect runner captures `activeScope` at creation time as `effectScope`,
 * and re-applies it around every callback execution (first run + re-runs).
 * This guarantees:
 *   - sub-scopes created inside the callback default-parent to the creation
 *     scope on every run (no orphan grandchildren),
 *   - inner effects created inside the callback register with the creation
 *     scope on every run (consistent dispose chain),
 *   - the behavior is identical for DEFERRED and EAGER.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    activeScope,
    effect,
    EffectOptions,
    flushEffects,
    scope,
    setActiveScope,
    signal,
} from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('runner restores activeScope to the effect creation scope', () => {
    afterEach(() => {
        setActiveScope(undefined);
    });

    it('DEFERRED: first run sees activeScope === creation scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        let observed;
        effect(() => {
            observed = activeScope;
        });

        // After effect() returns, but before the flush, activeScope is still outer.
        expect(activeScope).toBe(outer);

        setActiveScope(undefined);
        await flushAll();

        expect(observed).toBe(outer);
        outer();
    });

    it('DEFERRED: re-runs also see activeScope === creation scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        const s = signal(0);
        const seen = [];
        effect(() => {
            s();
            seen.push(activeScope);
        });

        setActiveScope(undefined);
        await flushAll();
        expect(activeScope).toBeUndefined();

        s.set(1);
        await flushAll();
        s.set(2);
        await flushAll();

        expect(seen).toEqual([outer, outer, outer]);
        outer();
    });

    it('EAGER: first run + re-runs see activeScope === creation scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        const s = signal(0);
        const seen = [];
        effect(
            () => {
                s();
                seen.push(activeScope);
            },
            EffectOptions.EAGER,
        );

        // First run already happened synchronously.
        expect(seen).toEqual([outer]);

        setActiveScope(undefined);
        s.set(1);
        await flushAll();
        s.set(2);
        await flushAll();

        expect(seen).toEqual([outer, outer, outer]);
        outer();
    });

    it('runner restores the previous activeScope after the callback finishes', async () => {
        const outer = scope();
        setActiveScope(outer);

        effect(() => {});
        setActiveScope(undefined);

        await flushAll();

        // After the flush, activeScope must be what it was before the flush.
        expect(activeScope).toBeUndefined();
        outer();
    });

    it('runner correctly nests when an EAGER effect creates another EAGER effect', () => {
        const outer = scope();
        setActiveScope(outer);

        let outerSeen;
        let innerSeen;
        let afterInnerSeen;

        effect(
            () => {
                outerSeen = activeScope;
                effect(
                    () => {
                        innerSeen = activeScope;
                    },
                    EffectOptions.EAGER,
                );
                // After the inner finishes, the outer's activeScope should be restored.
                afterInnerSeen = activeScope;
            },
            EffectOptions.EAGER,
        );

        expect(outerSeen).toBe(outer);
        expect(innerSeen).toBe(outer);
        expect(afterInnerSeen).toBe(outer);
        outer();
    });
});

describe('grandchild effects auto-register with the creation scope', () => {
    afterEach(() => {
        setActiveScope(undefined);
    });

    it('inner effect created during outer effect callback registers with outer creation scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        let innerRuns = 0;
        const s = signal(0);

        effect(() => {
            effect(() => {
                s();
                innerRuns++;
            });
        });

        setActiveScope(undefined);
        await flushAll();
        expect(innerRuns).toBe(1);

        // Dispose the outer scope. The inner effect is reachable from outer
        // (via the runner's setActiveScope restore), so it should be disposed
        // even though no explicit cleanup function returned the inner dispose.
        outer();

        s.set(1);
        await flushAll();
        // Inner effect did not re-run because it was disposed with outer.
        expect(innerRuns).toBe(1);
    });

    it('inner effect created during EAGER outer effect first run also registers with outer scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        let innerRuns = 0;
        const s = signal(0);

        effect(
            () => {
                effect(() => {
                    s();
                    innerRuns++;
                });
            },
            EffectOptions.EAGER,
        );

        // Outer ran synchronously; inner is DEFERRED so it flushes next tick.
        setActiveScope(undefined);
        await flushAll();
        expect(innerRuns).toBe(1);

        outer();
        s.set(1);
        await flushAll();
        expect(innerRuns).toBe(1);
    });

    it('sub-scope created without explicit parent attaches to outer creation scope', async () => {
        const outer = scope();
        setActiveScope(outer);

        let innerCleanupCalls = 0;
        effect(() => {
            scope(onDispose => {
                onDispose(() => {
                    innerCleanupCalls++;
                });
            });
        });

        setActiveScope(undefined);
        await flushAll();
        expect(innerCleanupCalls).toBe(0);

        outer();
        // Outer dispose tears down the effect AND the orphan-prone sub-scope.
        expect(innerCleanupCalls).toBe(1);
    });
});

describe('activeScope is restored even when the callback throws', () => {
    afterEach(() => {
        setActiveScope(undefined);
    });

    it('DEFERRED throw caught by flush loop: activeScope restored to pre-runner value', async () => {
        const outer = scope();
        setActiveScope(outer);

        effect(() => {
            throw new Error('boom');
        });

        // Leave activeScope as undefined when the flush runs, so we can detect
        // whether the runner's restore was honored.
        setActiveScope(undefined);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await Promise.resolve();
        flushEffects();
        await flushPromises();

        errSpy.mockRestore();

        // The flush should not leak the throwing effect's effectScope into the
        // surrounding activeScope. After the flush, activeScope must be what
        // it was before the flush started: undefined.
        expect(activeScope).toBeUndefined();

        outer();
    });

    it('REALISTIC: effect created after a throwing DEFERRED flush is NOT bound to the throwing scope', async () => {
        // Component A: creates an effect inside its scope that throws on flush.
        const scopeA = scope();
        setActiveScope(scopeA);
        effect(() => {
            throw new Error('A failed');
        });
        setActiveScope(undefined);

        // Microtask boundary: the flush fires. If the runner doesn't restore
        // activeScope on throw, it dangles at scopeA here.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await Promise.resolve();
        flushEffects();
        await flushPromises();
        errSpy.mockRestore();

        // User code resumes, believes no scope is active, creates a free effect.
        let bCleanupCalls = 0;
        effect(() => {
            return () => {
                bCleanupCalls++;
            };
        });
        await flushAll();

        // Dispose scopeA (component A teardown). If the free effect leaked
        // into scopeA via a dangle, its cleanup would fire here.
        scopeA();

        // Correct behavior: the unrelated effect was NOT tracked by scopeA,
        // so its cleanup is not called. (Without the runner's restore on
        // throw, this would be 1 — proving the leak.)
        expect(bCleanupCalls).toBe(0);
    });
});
