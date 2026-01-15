/**
 * @import { Computed, EffectCleanup } from './index.js'
 */

import { append } from '@slimlib/list';

import { batched, batchedDelete, clearSources, scheduleFlush } from './core.js';
import { registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_COMPUTING, FLAG_DIRTY, FLAG_EFFECT, FLAG_NEEDS_WORK } from './flags.js';
import { activeScope, currentComputing, setCurrentComputing, setTracked, tracked } from './globals.js';
import { dependencies, flagsSymbol, getterSymbol, skippedDeps, sources, trackSymbol, versionSymbol } from './symbols.js';

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
 * Run function for effect nodes
 * Simplified version of computedRead - effects don't need:
 * - Dependency tracking on read (effects are leaves, nothing reads them)
 * - Value caching/comparison (effects always run, value is discarded)
 * - Version tracking (nothing polls effects)
 * - Error caching/rethrowing (effects handle errors differently)
 * - CHECK verification (effects are always marked DIRTY)
 * - Polling logic (effects are always live)
 * @this {Effect<void>}
 */
function effectRun() {
    const flags = this[flagsSymbol];
    const sourcesArray = this[sources];

    // Cycle detection: if this effect is already being computed, we have a cycle
    if (flags & FLAG_COMPUTING) {
        throw new Error('Detected cycle in computations.');
    }

    // Only run if we need work (DIRTY or CHECK)
    if (!(flags & FLAG_NEEDS_WORK)) {
        return;
    }

    this[flagsSymbol] = (flags & ~FLAG_NEEDS_WORK) | FLAG_COMPUTING;

    // Reset skipped deps counter for this run
    this[skippedDeps] = 0;

    const prev = currentComputing;
    const prevTracked = tracked;
    setCurrentComputing(/** @type {Computed<any>} */ (/** @type {unknown} */ (this)));
    setTracked(true);

    try {
        this[getterSymbol]();
    } finally {
        setCurrentComputing(prev);
        setTracked(prevTracked);
        this[flagsSymbol] &= ~FLAG_COMPUTING;

        // Update source versions now that all sources have computed
        const skipped = this[skippedDeps];
        const updateLen = Math.min(skipped, sourcesArray.length);
        for (let i = 0; i < updateLen; i++) {
            const entry = sourcesArray[i];
            if (entry.n) {
                entry.v = entry.n[versionSymbol];
            }
        }
        // Clean up any excess sources that weren't reused
        if (sourcesArray.length > skipped) {
            clearSources(this, skipped);
        }
    }
}

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
    const eff = /** @type {Effect<void>} */ (() => effectRun.call(eff));

    // Initialize properties
    eff[sources] = [];
    eff[dependencies] = new Set(); // Empty - effects have no dependents (they are leaves)
    eff[flagsSymbol] = FLAG_DIRTY | FLAG_EFFECT;
    eff[skippedDeps] = 0;
    eff[getterSymbol] = () => {
        // Run previous cleanup if it exists
        if (typeof cleanup === 'function') {
            cleanup();
        }
        // Run the callback and store new cleanup
        cleanup = callback();
    };
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

    // Trigger first run via batched queue (node is already dirty)
    append(batched, eff);
    scheduleFlush();

    return dispose;
};