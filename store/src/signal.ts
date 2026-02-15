import { DepsSet, currentComputing, markDependents, trackStateDependency, tracked } from './core';
import { warnIfWriteInComputed } from './debug';
import type { ReactiveNode } from './internal-types';
import type { Signal } from './types';

/**
 * Create a simple signal without an initial value
 */
export function signal<T>(): Signal<T | undefined>;
/**
 * Create a simple signal with an initial value
 */
export function signal<T>(initialValue: T): Signal<T>;
/**
 * Create a simple signal
 */
export function signal<T>(initialValue?: T): Signal<T> {
    let value = initialValue as T;
    let deps: DepsSet<ReactiveNode> | undefined;

    /**
     * Read the signal value and track dependency
     */
    const read = (): T => {
        // === PULL PHASE ===
        // When a computed/effect reads this signal, we register the dependency
        // Fast path: if not tracked or no current computing, skip tracking
        if (tracked && currentComputing !== undefined) {
            // Pass value getter for polling optimization (value revert detection)
            // biome-ignore lint/suspicious/noAssignInExpressions: optimization
            trackStateDependency((deps ??= new DepsSet<ReactiveNode>(read)), read, value);
        }
        return value;
        // === END PULL PHASE ===
    };

    /**
     * Set a new value and notify dependents
     */
    read.set = (newValue: T): void => {
        // === PUSH PHASE ===
        // When the signal value changes, we eagerly propagate dirty/check flags
        // to all dependents via markDependents
        warnIfWriteInComputed('signal');
        if (!Object.is(value, newValue)) {
            value = newValue;
            if (deps !== undefined) {
                markDependents(deps); // Push: notify all dependents
            }
        }
        // === END PUSH PHASE ===
    };

    return read;
}
