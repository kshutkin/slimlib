/**
 * @import { Computed, EffectCleanup } from './index.js'
 */

import { computed } from './computed.js';
import { batched, batchedDelete, clearSources, scheduleFlush } from './core.js';
import { append } from '@slimlib/list';
import { registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_EFFECT } from './flags.js';
import { activeScope } from './globals.js';
import { flagsSymbol, trackSymbol } from './symbols.js';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 0;

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

    // Effects use a custom equals that always returns false to ensure they always run
    const comp = /** @type {Computed<void | (() => void)>} */ (
        computed(
            () => {
                // Run previous cleanup if it exists
                if (typeof cleanup === 'function') {
                    cleanup();
                }
                // Run the callback and store new cleanup
                cleanup = callback();
            },
            () => false
        )
    );
    comp[flagsSymbol] |= FLAG_EFFECT;
    comp.i = effectCreationCounter++;

    const dispose = () => {
        // Unregister from GC tracking (only in DEV mode)
        unregisterEffect(gcToken);
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearSources(comp);
        batchedDelete(comp);
    };

    // Track to appropriate scope
    if (activeScope) {
        activeScope[trackSymbol](dispose);
    }

    // Trigger first run via batched queue (node is already dirty from computed())
    append(batched, comp);
    scheduleFlush();

    return dispose;
};
