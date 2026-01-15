/**
 * @import { EffectCleanup } from './index.js'
 */

import { append } from '@slimlib/list';

import { batched, batchedDelete, clearSources, runWithTracking, scheduleFlush } from './core.js';
import { registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_COMPUTING, FLAG_DIRTY, FLAG_EFFECT } from './flags.js';
import { activeScope } from './globals.js';
import { flagsSymbol, skippedDeps, sources, trackSymbol } from './symbols.js';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 0;

/**
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any, n?: import('@slimlib/list').ListNode, p?: import('@slimlib/list').ListNode, i?: number }} Effect
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
        if (eff[flagsSymbol] & FLAG_COMPUTING) {
            throw new Error('Detected cycle in computations.');
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
        batchedDelete(eff);
    };

    // Track to appropriate scope
    if (activeScope) {
        activeScope[trackSymbol](dispose);
    }

    // Trigger first run via batched queue (node is already dirty, and effect is for sure with the latest id)
    append(batched, eff);
    scheduleFlush();

    return dispose;
};
