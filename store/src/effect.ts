import { batched, batchedAddNew, checkComputedSources, clearSources, runWithTracking, scheduleFlush } from './core';
import { cycleMessage, registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug';
import { FLAG_CHECK, FLAG_COMPUTING, FLAG_DIRTY, FLAG_EFFECT, FLAG_NEEDS_WORK } from './flags';
import { activeScope } from './globals';
import { flagsSymbol, skippedDeps, sources, trackSymbol } from './symbols';
import type { Effect, EffectCleanup, SourceEntry } from './types';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 1;

/**
 * Creates a reactive effect that runs when dependencies change
 */
export const effect = (callback: () => void | EffectCleanup): (() => void) => {
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
        const flags = eff[flagsSymbol] as number;
        if (flags & FLAG_COMPUTING) {
            throw new Error(cycleMessage);
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Verify if sources actually changed before running
        // ----------------------------------------------------------------
        // Bail-out optimization: if only CHECK flag is set (not DIRTY),
        // verify that computed sources actually changed before running
        if ((flags & FLAG_NEEDS_WORK) === FLAG_CHECK) {
            // PULL: Read computed sources to check if they changed
            const result = checkComputedSources(eff[sources] as SourceEntry[]);
            // If null, can't verify (has state sources or empty) - proceed to run
            // If false, sources didn't change - clear CHECK flag and skip
            // If true, sources changed or errored - proceed to run
            if (result === false) {
                eff[flagsSymbol] = flags & ~FLAG_CHECK;
                return;
            }
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Execute effect and track dependencies
        // ----------------------------------------------------------------
        runWithTracking(eff, () => {
            // Run previous cleanup if it exists
            if (typeof cleanup === 'function') {
                cleanup();
            }
            // Run the callback and store new cleanup
            // (callback will PULL values from signals/state/computed)
            cleanup = callback();
        });
    }) as Effect<void>;

    // Initialize properties
    eff[sources] = [];
    eff[flagsSymbol] = FLAG_DIRTY | FLAG_EFFECT;
    eff[skippedDeps] = 0;
    const effectId = effectCreationCounter++;
    eff.i = effectId;

    const dispose = (): void => {
        // Mark as disposed to prevent running if still in batched queue
        disposed = true;
        // Unregister from GC tracking (only in DEV mode)
        unregisterEffect(gcToken);
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearSources(eff);
        batched.delete(eff);
    };

    // Track to appropriate scope
    if (activeScope) {
        activeScope[trackSymbol](dispose);
    }

    // ----------------------------------------------------------------
    // Initial scheduling (triggers first PULL when flush runs)
    // ----------------------------------------------------------------
    // Trigger first run via batched queue
    // node is already dirty
    // and effect is for sure with the latest id so we directly adding without the sort
    batchedAddNew(eff, effectId);
    scheduleFlush();

    return dispose;
};
