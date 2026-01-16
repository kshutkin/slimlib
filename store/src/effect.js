/**
 * @import { EffectCleanup } from './index.js'
 */

import { batched, clearSources, runWithTracking, scheduleFlush, untracked } from './core.js';
import { registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_CHECK, FLAG_COMPUTING, FLAG_DIRTY, FLAG_EFFECT, FLAG_NEEDS_WORK } from './flags.js';
import { activeScope } from './globals.js';
import { flagsSymbol, skippedDeps, sources, trackSymbol, versionSymbol } from './symbols.js';

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

    // Register effect for GC tracking (only in DEV mode)
    const gcToken = registerEffect();

    // Warn if effect is created without an active scope (only in DEV mode when enabled)
    warnIfNoActiveScope(activeScope);

    // Create callable that invokes effectRun with itself as `this`
    const eff = /** @type {Effect<void>} */ (() => {
        // Cycle detection: if this node is already being computed, we have a cycle
        const flags = eff[flagsSymbol];
        if (flags & FLAG_COMPUTING) {
            throw new Error('Detected cycle in computations.');
        }

        // Bail-out optimization: if only CHECK flag is set (not DIRTY),
        // verify that computed sources actually changed before running
        if ((flags & FLAG_NEEDS_WORK) === FLAG_CHECK) {
            const sourcesArray = eff[sources];
            // Check if we only have computed sources (sources with nodes)
            let hasStateSources = false;
            for (const source of sourcesArray) {
                if (!source.n) {
                    hasStateSources = true;
                    break;
                }
            }

            if (!hasStateSources && sourcesArray.length > 0) {
                let sourceChanged = false;
                let sourceErrored = false;
                untracked(() => {
                    for (const sourceEntry of sourcesArray) {
                        const sourceNode = sourceEntry.n;
                        // Access source to trigger its recomputation if needed
                        try {
                            sourceNode();
                        } catch {
                            // If source throws, effect must run to handle the error
                            sourceErrored = true;
                        }
                        // Check if source version changed (meaning its value changed)
                        if (sourceEntry.v !== sourceNode[versionSymbol]) {
                            sourceChanged = true;
                            sourceEntry.v = sourceNode[versionSymbol];
                        }
                    }
                });

                if (!sourceChanged && !sourceErrored) {
                    // Sources didn't change, clear CHECK flag and skip execution
                    eff[flagsSymbol] = flags & ~FLAG_CHECK;
                    return;
                }
            }
        }

        runWithTracking(eff, () => {
            // Run previous cleanup if it exists
            if (typeof cleanup === 'function') {
                cleanup();
            }
            // Run the callback and store new cleanup
            cleanup = callback();
        });
    });

    // Initialize properties
    eff[sources] = [];
    eff[flagsSymbol] = FLAG_DIRTY | FLAG_EFFECT;
    eff[skippedDeps] = 0;
    eff.i = effectCreationCounter++;

    const dispose = () => {
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

    // Trigger first run via batched queue (node is already dirty, and effect is for sure with the latest id so we directly adding without the sort)
    batched.add(eff);
    scheduleFlush();

    return dispose;
};
