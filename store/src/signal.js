/**
 * @import { Computed, Signal } from './index.js'
 */

import { currentComputing, tracked } from './globals.js';
import { markDependents, trackDependency } from './core.js';
import { warnIfWriteInComputed } from './debug.js';

/**
 * Create a simple signal without an initial value
 * @template T
 * @overload
 * @returns {Signal<T | undefined>}
 */
/**
 * Create a simple signal with an initial value
 * @template T
 * @overload
 * @param {T} initialValue - Initial value for the signal
 * @returns {Signal<T>}
 */
/**
 * Create a simple signal
 * @template T
 * @param {T} [initialValue] - Optional initial value for the signal
 * @returns {Signal<T>}
 */
export function signal(initialValue) {
    let value = /** @type {T} */ (initialValue);
    /** @type {Set<Computed<any>> | null} */
    let deps = null;

    /**
     * Read the signal value and track dependency
     * @returns {T}
     */
    const read = () => {
        // Fast path: if not tracked or no current computing, skip tracking
        if (tracked && currentComputing) {
            deps ||= new Set();
            trackDependency(deps);
        }
        return value;
    };

    /**
     * Set a new value and notify dependents
     * @param {T} newValue
     */
    read.set = newValue => {
        warnIfWriteInComputed('signal');
        if (!Object.is(value, newValue)) {
            value = newValue;
            if (deps) markDependents(deps);
        }
    };

    return read;
}
