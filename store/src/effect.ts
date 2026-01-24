import { batched, batchedAddNew, checkComputedSources, clearSources, runWithTracking, scheduleFlush } from './core';
import { cycleMessage, registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug';
import { Flag } from './flags';
import { activeScope } from './globals';
import { trackSymbol } from './symbols';
import type { InternalEffect, ReactiveNode } from './internal-types';
import type { EffectCleanup } from './types';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 1;

/**
 * Creates a reactive effect that runs when dependencies change
 */
// biome-ignore lint/suspicious/noConfusingVoidType: void is semantically correct here - callback may return nothing or a cleanup function
export const effect = (callback: () => void | EffectCleanup): (() => void) => {
    // biome-ignore lint/suspicious/noConfusingVoidType: matches callback return type
    let cleanup: void | EffectCleanup;
    let disposed = false;

    // Register effect for GC tracking (only in DEV mode)
    const gcToken = registerEffect();

    // Warn if effect is created without an active scope (only in DEV mode when enabled)
    warnIfNoActiveScope(activeScope);

    // Create callable that invokes effectRun with itself as `this`
    const eff = (() => {
        // Skip if effect was disposed (may still be in batched queue from before disposal)
        if (disposed) {
            return;
        }

        // Cycle detection: if this node is already being computed, we have a cycle
        const flags = eff.$_flags;
        if (flags & Flag.COMPUTING) {
            throw new Error(cycleMessage);
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Verify if sources actually changed before running
        // ----------------------------------------------------------------
        // Bail-out optimization: if only CHECK flag is set (not DIRTY),
        // verify that computed sources actually changed before running
        if ((flags & (Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) === Flag.CHECK) {
            // PULL: Read computed sources to check if they changed
            // If false, sources didn't change - clear CHECK flag and skip
            // If true, sources changed or errored - proceed to run
            if (!checkComputedSources(eff.$_sources)) {
                eff.$_flags = flags & ~Flag.CHECK;
                return;
            }
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Execute effect and track dependencies
        // ----------------------------------------------------------------
        runWithTracking(eff as unknown as ReactiveNode, () => {
            // Run previous cleanup if it exists
            if (typeof cleanup === 'function') {
                cleanup();
            }
            // Run the callback and store new cleanup
            // (callback will PULL values from signals/state/computed)
            cleanup = callback();
        });
    }) as InternalEffect;

    // Initialize properties
    eff.$_sources = [];
    eff.$_flags = Flag.DIRTY | Flag.EFFECT;
    eff.$_skipped = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: optimization
    const effectId = eff.$_id = ++effectCreationCounter;

    const dispose = (): void => {
        // Mark as disposed to prevent running if still in batched queue
        disposed = true;
        // Unregister from GC tracking (only in DEV mode)
        unregisterEffect(gcToken);
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearSources(eff as unknown as ReactiveNode);
        batched.delete(eff as unknown as ReactiveNode);
    };

    // Track to appropriate scope
    if (activeScope) {
        (activeScope[trackSymbol] as (dispose: () => void) => void)(dispose);
    }

    // ----------------------------------------------------------------
    // Initial scheduling (triggers first PULL when flush runs)
    // ----------------------------------------------------------------
    // Trigger first run via batched queue
    // node is already dirty
    // and effect is for sure with the latest id so we directly adding without the sort
    batchedAddNew(eff as unknown as ReactiveNode, effectId);
    scheduleFlush();

    return dispose;
};
