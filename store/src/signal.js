/**
 * @import { Computed, Signal } from './index.js'
 */

import { currentComputing, markDependents, trackStateDependency, tracked } from './core.js';
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
    let deps;

    /**
     * Read the signal value and track dependency
     * @returns {T}
     */
    const read = () => {
        // === PULL PHASE ===
        // When a computed/effect reads this signal, we register the dependency
        // Fast path: if not tracked or no current computing, skip tracking
        if (tracked && currentComputing) {
            // Pass value getter for polling optimization (value revert detection)
            // biome-ignore lint/suspicious/noAssignInExpressions: optimization
            trackStateDependency((deps ||= new Set()), () => value);
        }
        return value;
        // === END PULL PHASE ===
    };

    /**
     * Set a new value and notify dependents
     * @param {T} newValue
     */
    read.set = newValue => {
        // === PUSH PHASE ===
        // When the signal value changes, we eagerly propagate dirty/check flags
        // to all dependents via markDependents
        warnIfWriteInComputed('signal');
        if (!Object.is(value, newValue)) {
            value = newValue;
            if (deps) markDependents(deps); // Push: notify all dependents
        }
        // === END PUSH PHASE ===
    };

    return read;
}
