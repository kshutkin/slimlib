import { checkComputedSources, clearSources, currentComputing, globalVersion, makeLive, runWithTracking, setTracked, tracked } from './core';
import { cycleMessage } from './debug';
import { Flag } from './flags';
import type { DepsSet, ReactiveNode } from './internal-types';
import type { Computed } from './types';

/**
 * Read function for computed nodes
 */
export function computedRead<T>(self: ReactiveNode): T {
    // ===== PULL PHASE: Register this computed as a dependency of the current consumer =====
    // Track if someone is reading us
    if (tracked && currentComputing) {
        // Inline tracking for computed dependencies
        const consumerSources = currentComputing.$_sources;
        const skipIndex = currentComputing.$_skipped;
        const deps = self.$_deps;

        if (consumerSources[skipIndex]?.$_dependents !== deps) {
            // Different dependency - clear old ones from this point and rebuild
            if (skipIndex < consumerSources.length) {
                clearSources(currentComputing, skipIndex);
            }

            // Push source entry - version will be updated after source computes
            consumerSources.push({
                $_dependents: deps as DepsSet<ReactiveNode>,
                $_node: self,
                $_version: 0,
            });

            // Only register with source if we're live
            if (currentComputing.$_flags & Flag.LIVE_EFFECT) {
                (deps as DepsSet<ReactiveNode>).add(currentComputing);
                // If source computed is not live, make it live
                if (!(self.$_flags & Flag.LIVE_EFFECT)) {
                    makeLive(self);
                }
            }
        }
        ++currentComputing.$_skipped;
    }

    let flags = self.$_flags;
    const sourcesArray = self.$_sources;

    // Cycle detection: if this computed is already being computed, we have a cycle
    // This matches TC39 Signals proposal behavior: throw an error on cyclic reads
    if (flags & Flag.COMPUTING) {
        throw new Error(cycleMessage);
    }

    // ===== PULL PHASE: Check if cached value can be returned =====
    // Combined check: node has cached result and doesn't need work
    const hasCached = flags & (Flag.HAS_VALUE | Flag.HAS_ERROR);

    // biome-ignore lint/suspicious/noConfusingLabels: expected
    checkCache: if (!(flags & Flag.NEEDS_WORK) && hasCached) {
        // Fast-path: nothing has changed globally since last read
        if (self.$_lastGlobalVersion === globalVersion) {
            if (flags & Flag.HAS_ERROR) {
                throw self.$_value;
            }
            return self.$_value as T;
        }

        // ===== PULL PHASE: Poll sources for non-live computeds =====
        // Non-live nodes poll instead of receiving push notifications
        if (!(flags & Flag.LIVE_EFFECT)) {
            let sourceChanged = false;

            // Disable tracking while polling sources to avoid unnecessary dependency tracking
            const prevTracked = setTracked(false);
            for (const source of sourcesArray) {
                if (!source.$_node) {
                    // State source - check if deps version changed
                    const currentDepsVersion = (source.$_dependents as DepsSet<ReactiveNode>).$_version || 0;
                    if (source.$_version !== currentDepsVersion) {
                        // Deps version changed, check if actual value reverted (primitives only)
                        const storedValue = source.$_storedValue;
                        const storedType = typeof storedValue;
                        if (source.$_getter && (storedValue === null || (storedType !== 'object' && storedType !== 'function'))) {
                            const currentValue = source.$_getter();
                            if (Object.is(currentValue, storedValue)) {
                                // Value reverted - update depsVersion and continue checking
                                source.$_version = currentDepsVersion;
                                continue;
                            }
                        }
                        // Value actually changed - mark DIRTY and skip remaining
                        sourceChanged = true;
                        break;
                    }
                } else {
                    // Computed source - check inline to avoid temporary array allocation
                    const sourceNode = source.$_node;
                    try {
                        computedRead(sourceNode);
                    } catch {
                        // Error counts as changed
                        sourceChanged = true;
                        break;
                    }
                    if (source.$_version !== sourceNode.$_version) {
                        sourceChanged = true;
                        break; // EXIT EARLY - don't process remaining sources
                    }
                }
            }
            setTracked(prevTracked);

            if (sourceChanged) {
                // Source changed or threw - mark DIRTY and proceed to recompute
                self.$_flags = flags |= Flag.DIRTY;
                break checkCache;
            }

            // No sources changed - return cached value
            self.$_lastGlobalVersion = globalVersion;
            if (flags & Flag.HAS_ERROR) {
                throw self.$_value;
            }
            return self.$_value as T;
        }
    }

    // ===== PULL PHASE: Verify CHECK state for live computeds =====
    // Live computeds receive CHECK via push - verify sources before recomputing
    // Non-live computeds already verified above during polling
    // Note: Check for Flag.HAS_VALUE OR Flag.HAS_ERROR since cached errors should also use this path
    // Note: Using Flag.NEEDS_WORK instead of Flag.CHECK_ONLY since computeds never have Flag.EFFECT
    if ((flags & Flag.CHECK_PURE_MASK) === Flag.CHECK && hasCached) {
        if (checkComputedSources(sourcesArray)) {
            // Sources changed or errored - mark DIRTY and let getter run
            self.$_flags = flags = (flags & ~Flag.CHECK) | Flag.DIRTY;
        } else {
            // Sources unchanged, clear CHECK flag and return cached value
            self.$_flags = flags & ~Flag.CHECK;
            self.$_lastGlobalVersion = globalVersion;
            if (flags & Flag.HAS_ERROR) {
                throw self.$_value;
            }
            return self.$_value as T;
        }
    }

    // ===== PULL PHASE: Recompute value by pulling from sources =====
    // Recompute if dirty or check (sources actually changed)
    if (flags & Flag.NEEDS_WORK) {
        const wasDirty = flags & Flag.DIRTY;

        runWithTracking(self, () => {
            try {
                const newValue = (self.$_getter as () => T)();

                // Check if value actually changed (common path: no error recovery)
                const changed = !(flags & Flag.HAS_VALUE) || !(self.$_equals as (a: T, b: T) => boolean)(self.$_value as T, newValue);

                if (changed) {
                    self.$_value = newValue;
                    // Increment version to indicate value changed (for polling)
                    self.$_version++;
                    self.$_flags = (self.$_flags | Flag.HAS_VALUE) & ~Flag.HAS_ERROR;
                    // ===== PUSH PHASE (during pull): Mark CHECK-only dependents as DIRTY =====
                    // When value changes during recomputation, upgrade dependent CHECK flags to DIRTY
                    for (const dep of self.$_deps as Set<ReactiveNode>) {
                        const depFlags = dep.$_flags;
                        if ((depFlags & Flag.SKIP_NOTIFY) === Flag.CHECK) {
                            dep.$_flags = depFlags | Flag.DIRTY;
                        }
                    }
                } else if (wasDirty) {
                    self.$_flags |= Flag.HAS_VALUE;
                }

                // Update last seen global version
                self.$_lastGlobalVersion = globalVersion;
            } catch (e) {
                // Per TC39 Signals proposal: cache the error and mark as clean with error flag
                // The error will be rethrown on subsequent reads until a dependency changes
                // Reuse valueSymbol for error storage since a computed can't have both value and error
                // Increment version since the result changed (to error)
                self.$_version++;
                self.$_value = e as T;
                self.$_flags = (self.$_flags & ~Flag.HAS_VALUE) | Flag.HAS_ERROR;
                self.$_lastGlobalVersion = globalVersion;
            }
        });
    }

    // Check if we have a cached error to rethrow (stored in valueSymbol)
    if (self.$_flags & Flag.HAS_ERROR) {
        throw self.$_value;
    }

    return self.$_value as T;
}

/**
 * Creates a computed value that automatically tracks dependencies and caches results
 */
export const computed = <T>(getter: () => T, equals: (a: T, b: T) => boolean = Object.is): Computed<T> =>
    (computedRead as (self: ReactiveNode) => T).bind(undefined, {
        $_sources: [],
        $_deps: new Set(),
        $_flags: Flag.DIRTY,
        $_skipped: 0,
        $_version: 0,
        $_getter: getter,
        $_equals: equals,
    } as unknown as ReactiveNode) as Computed<T>;
