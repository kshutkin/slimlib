import { checkComputedSources, currentComputing, globalVersion, runWithTracking, setTracked, tracked, trackComputedDependency } from './core';
import { cycleMessage } from './debug';
import { Flag } from './flags';
import type { ReactiveNode, Subscribable } from './internal-types';
import type { Computed } from './types';

/**
 * Check if a Subscribable is a full ReactiveNode
 */
const isReactiveNode = (node: Subscribable): node is ReactiveNode => {
    return '$_flags' in node;
};

/**
 * Read function for computed nodes
 */
export function computedRead<T>(self: ReactiveNode): T {
    // ===== PULL PHASE: Register this computed as a dependency of the current consumer =====
    // Track if someone is reading us
    if (tracked && currentComputing) {
        trackComputedDependency(self);
    }

    let flags = self.$_flags;

    // Cycle detection: if this computed is already being computed, we have a cycle
    // This matches TC39 Signals proposal behavior: throw an error on cyclic reads
    if ((flags & Flag.COMPUTING) !== 0) {
        throw new Error(cycleMessage);
    }

    // ===== PULL PHASE: Check if cached value can be returned =====
    // Combined check: node has cached result and doesn't need work
    const hasCached = (flags & (Flag.HAS_VALUE | Flag.HAS_ERROR)) !== 0;

    // biome-ignore lint/suspicious/noConfusingLabels: expected
    checkCache: if (!(flags & (Flag.DIRTY | Flag.CHECK)) && hasCached) {
        // Fast-path: nothing has changed globally since last read
        if (self.$_lastGlobalVersion === globalVersion) {
            if (flags & Flag.HAS_ERROR) {
                throw self.$_value;
            }
            return self.$_value as T;
        }

        // ===== PULL PHASE: Poll sources for non-live computeds =====
        // Non-live nodes poll instead of receiving push notifications
        if ((flags & Flag.LIVE) === 0) {
            let sourceChanged = false;

            // Disable tracking while polling sources to avoid unnecessary dependency tracking
            const prevTracked = setTracked(false);
            let linkNode = self.$_deps;
            while (linkNode !== undefined) {
                const dep = linkNode.$_dep;
                
                if (!isReactiveNode(dep)) {
                    // State source - check if deps version changed
                    const currentDepsVersion = dep.$_version;
                    if (linkNode.$_version !== currentDepsVersion) {
                        // Deps version changed, check if actual value reverted (primitives only)
                        const storedValue = linkNode.$_storedValue;
                        const storedType = typeof storedValue;
                        if (linkNode.$_getter && (storedValue === null || (storedType !== 'object' && storedType !== 'function'))) {
                            const currentValue = linkNode.$_getter();
                            if (Object.is(currentValue, storedValue)) {
                                // Value reverted - update version and continue checking
                                linkNode.$_version = currentDepsVersion;
                                linkNode = linkNode.$_nextDep;
                                continue;
                            }
                        }
                        // Value actually changed - mark DIRTY and skip remaining
                        sourceChanged = true;
                        break;
                    }
                } else {
                    // Computed source - check inline to avoid temporary array allocation
                    try {
                        computedRead(dep);
                    } catch {
                        // Error counts as changed
                        sourceChanged = true;
                        break;
                    }
                    if (linkNode.$_version !== dep.$_version) {
                        sourceChanged = true;
                        break; // EXIT EARLY - don't process remaining sources
                    }
                }
                linkNode = linkNode.$_nextDep;
            }
            setTracked(prevTracked);

            if (sourceChanged) {
                // Source changed or threw - mark DIRTY and proceed to recompute
                self.$_flags = flags |= Flag.DIRTY;
                break checkCache;
            }

            // No sources changed - return cached value
            self.$_lastGlobalVersion = globalVersion;
            if ((flags & Flag.HAS_ERROR) !== 0) {
                throw self.$_value;
            }
            return self.$_value as T;
        }
    }

    // ===== PULL PHASE: Verify CHECK state for live computeds =====
    // Live computeds receive CHECK via push - verify sources before recomputing
    // Non-live computeds already verified above during polling
    // Note: Check for Flag.HAS_VALUE OR Flag.HAS_ERROR since cached errors should also use this path
    if ((flags & (Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) === Flag.CHECK && hasCached) {
        if (checkComputedSources(self)) {
            // Sources changed or errored - mark DIRTY and let getter run
            self.$_flags = flags = (flags & ~Flag.CHECK) | Flag.DIRTY;
        } else {
            // Sources unchanged, clear CHECK flag and return cached value
            self.$_flags = flags & ~Flag.CHECK;
            // No sources changed - return cached value
            self.$_lastGlobalVersion = globalVersion;
            if ((flags & Flag.HAS_ERROR) !== 0) {
                throw self.$_value;
            }
            return self.$_value as T;
        }
    }

    // ===== PULL PHASE: Recompute value by pulling from sources =====
    // Recompute if dirty or check (sources actually changed)
    if ((flags & (Flag.DIRTY | Flag.CHECK)) !== 0) {
        const wasDirty = (flags & Flag.DIRTY) !== 0;

        runWithTracking(self, () => {
            try {
                const newValue = (self.$_getter as () => T)();

                // Check if value actually changed (common path: no error recovery)
                const changed =
                    (flags & Flag.HAS_VALUE) === 0 || !(self.$_equals as (a: T, b: T) => boolean)(self.$_value as T, newValue);

                if (changed) {
                    self.$_value = newValue;
                    // Increment version to indicate value changed (for polling)
                    self.$_version++;
                    self.$_flags = (self.$_flags | Flag.HAS_VALUE) & ~Flag.HAS_ERROR;
                    // ===== PUSH PHASE (during pull): Mark CHECK-only dependents as DIRTY =====
                    // When value changes during recomputation, upgrade dependent CHECK flags to DIRTY
                    let link = self.$_subs;
                    while (link !== undefined) {
                        const depFlags = link.$_sub.$_flags;
                        if ((depFlags & (Flag.COMPUTING | Flag.DIRTY | Flag.CHECK)) === Flag.CHECK) {
                            link.$_sub.$_flags = depFlags | Flag.DIRTY;
                        }
                        link = link.$_nextSub;
                    }
                } else if (wasDirty) {
                    self.$_flags |= Flag.HAS_VALUE;
                }

                // Update last seen global version
                self.$_lastGlobalVersion = globalVersion;
            } catch (e) {
                // Per TC39 Signals proposal: cache the error and mark as clean with error flag
                // The error will be rethrown on subsequent reads until a dependency changes
                // Reuse value for error storage since a computed can't have both value and error
                // Increment version since the result changed (to error)
                self.$_version++;
                self.$_value = e as T;
                self.$_flags = (self.$_flags & ~Flag.HAS_VALUE) | Flag.HAS_ERROR;
                self.$_lastGlobalVersion = globalVersion;
            }
        });
    }

    // Check if we have a cached error to rethrow (stored in value)
    if ((self.$_flags & Flag.HAS_ERROR) !== 0) {
        throw self.$_value;
    }

    return self.$_value as T;
}

/**
 * Creates a computed value that automatically tracks dependencies and caches results
 */
export const computed = <T>(getter: () => T, equals: (a: T, b: T) => boolean = Object.is): Computed<T> => {
    const node: ReactiveNode = {
        $_deps: undefined,
        $_depsTail: undefined,
        $_subs: undefined,
        $_subsTail: undefined,
        $_flags: Flag.DIRTY,
        $_version: 0,
        $_value: undefined,
        $_lastGlobalVersion: 0,
        $_getter: getter as () => unknown,
        $_equals: equals as (a: unknown, b: unknown) => boolean,
        $_id: 0,
        $_fn: undefined,
    };

    return () => computedRead(node);
};