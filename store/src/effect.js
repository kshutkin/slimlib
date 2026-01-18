/**
 * @import { EffectCleanup } from './index.js'
 */

// ============================================================================
// PUSH/PULL REACTIVE SYSTEM - EFFECT MODULE
// ============================================================================
// Effects are always "live" - they receive push notifications when sources change.
// When an effect runs, it PULLS values from its sources (computed/signal/state).
// ============================================================================

import { batched, batchedAddNew, checkComputedSources, clearSources, runWithTracking, scheduleFlush } from './core.js';
import { cycleMessage, registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_CHECK, FLAG_COMPUTING, FLAG_DIRTY, FLAG_EFFECT, FLAG_NEEDS_WORK } from './flags.js';
import { activeScope } from './globals.js';
import { flagsSymbol, skippedDeps, sources, trackSymbol } from './symbols.js';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 1;

/**
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any, i?: number }} Effect
 */

/**
 * Creates a reactive effect that runs when dependencies change
 * @param {() => void | EffectCleanup} callback - Effect function, can optionally return a cleanup function
 * @returns {() => void} Dispose function to stop the effect
 */
export const effect = callback => {
    /** @type {void | EffectCleanup} */
    let cleanup;
    let disposed = false;

    // Register effect for GC tracking (only in DEV mode)
    const gcToken = registerEffect();

    // Warn if effect is created without an active scope (only in DEV mode when enabled)
    warnIfNoActiveScope(activeScope);

    // Create callable that invokes effectRun with itself as `this`
    const eff = /** @type {Effect<void>} */ (() => {
        // Skip if effect was disposed (may still be in batched queue from before disposal)
        if (disposed) {
            return;
        }

        // Cycle detection: if this node is already being computed, we have a cycle
        const flags = eff[flagsSymbol];
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
            const result = checkComputedSources(eff[sources]);
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
    });

    // Initialize properties
    eff[sources] = [];
    eff[flagsSymbol] = FLAG_DIRTY | FLAG_EFFECT;
    eff[skippedDeps] = 0;
    const effectId = effectCreationCounter++;
    eff.i = effectId;

    const dispose = () => {
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
