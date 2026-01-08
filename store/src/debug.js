import { DEV } from 'esm-env';

import { FLAG_EFFECT } from './flags.js';
import { currentComputing } from './globals.js';
import { flagsSymbol } from './symbols.js';

/**
 * Debug configuration flag: Warn when writing to signals/state inside a computed
 * @type {number}
 */
export const WARN_ON_WRITE_IN_COMPUTED = 1 << 0;

/**
 * Current debug configuration bitfield
 * @type {number}
 */
let debugConfigFlags = 0;

/**
 * Configure debug behavior using a bitfield of flags
 * @param {number} flags - Bitfield of debug flags (e.g., WARN_ON_WRITE_IN_COMPUTED)
 * @returns {void}
 */
export const debugConfig = flags => {
    debugConfigFlags = flags | 0;
};

/**
 * Safely call each function in an iterable, logging any errors to console
 * @param {Iterable<() => void>} fns
 */
export const safeForEach = fns => {
    for (const fn of fns) {
        try {
            fn();
        } catch (e) {
            console.error(e);
        }
    }
};

/**
 * Warn if writing inside a computed (not an effect)
 * Only runs in DEV mode and when configured
 * @param {string} context - Description of where the write is happening
 */
export const warnIfWriteInComputed = context => {
    if (DEV && debugConfigFlags & WARN_ON_WRITE_IN_COMPUTED && currentComputing && !(currentComputing[flagsSymbol] & FLAG_EFFECT)) {
        console.warn(
            `[@slimlib/store] Writing to ${context} inside a computed is not recommended. ` +
                `The computed will not automatically re-run when this value changes, which may lead to stale values.`
        );
    }
};
