/**
 * @import { Computed, EffectCleanup } from './index.js'
 */

import { computed } from './computed.js';
import { batched, clearAllSources, scheduleFlush } from './core.js';
import { registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug.js';
import { FLAG_EFFECT } from './flags.js';
import { activeScope } from './globals.js';
import { flagsSymbol, trackSymbol } from './symbols.js';

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

    // Dispose function for this effect
    const dispose = () => {
        // Unregister from GC tracking (only in DEV mode)
        unregisterEffect(gcToken);
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearAllSources(comp);
        batched.delete(comp);
    };

    // Track to appropriate scope
    if (activeScope) {
        activeScope[trackSymbol](dispose);
    }

    // Trigger first run via batched queue (node is already dirty from computed())
    batched.add(comp);
    scheduleFlush();

    // Return dispose function
    return dispose;
};
