import { checkComputedSources, clearSources, currentComputing, globalVersion, makeLive, runWithTracking, tracked } from './core';
import { cycleMessage } from './debug';
import { Flag } from './flags';
import {
    dependencies,
    depsVersionSymbol,
    equalsSymbol,
    flagsSymbol,
    getterSymbol,
    lastGlobalVersionSymbol,
    skippedDeps,
    sources,
    valueSymbol,
    versionSymbol,
} from './symbols';
import type { Computed, SourceEntry } from './types';

/**
 * Read function for computed nodes
 */
export function computedRead<T>(this: Computed<T>): T {
    // biome-ignore lint/complexity/noUselessThisAlias: optimization
    const self = this as Computed<any>;

    // ===== PULL PHASE: Register this computed as a dependency of the current consumer =====
    // Track if someone is reading us
    if (tracked && currentComputing) {
        // Inline tracking for computed dependencies
        const consumer = currentComputing as Computed<any>;
        const consumerSources = consumer[sources] as SourceEntry[];
        const skipIndex = consumer[skippedDeps] as number;
        const deps = self[dependencies] as Set<Computed<any>>;

        if (consumerSources[skipIndex]?.d !== deps) {
            // Different dependency - clear old ones from this point and rebuild
            if (skipIndex < consumerSources.length) {
                clearSources(consumer, skipIndex);
            }

            // Push source entry - version will be updated after source computes
            consumerSources.push({
                d: deps,
                n: self,
                v: 0,
                dv: 0,
                g: undefined,
                sv: undefined,
            });

            // Only register with source if we're live
            if (consumer[flagsSymbol] & Flag.IS_LIVE) {
                deps.add(consumer);
                // If source computed is not live, make it live
                if (!(self[flagsSymbol] & Flag.IS_LIVE)) {
                    makeLive(self);
                }
            }
        }
        ++consumer[skippedDeps];
    }

    let flags = self[flagsSymbol] as number;
    const sourcesArray = self[sources] as SourceEntry[];

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
        if (self[lastGlobalVersionSymbol] === globalVersion) {
            if (flags & Flag.HAS_ERROR) {
                throw self[valueSymbol];
            }
            return self[valueSymbol];
        }

        // ===== PULL PHASE: Poll sources for non-live computeds =====
        // Non-live nodes poll instead of receiving push notifications
        if (!(flags & Flag.IS_LIVE)) {
            let stateSourceChanged = false;

            // Fast path: if no state/signal sources, skip the polling loop entirely
            // and just verify computed sources
            if (flags & Flag.HAS_STATE_SOURCE) {
                // Has state sources - must poll each one
                let computedSourcesToCheck: SourceEntry[] | null = null;

                for (const source of sourcesArray) {
                    if (!source.n) {
                        // State source - check if deps version changed
                        const currentDepsVersion = (source.d as any)[depsVersionSymbol] || 0;
                        if (source.dv !== currentDepsVersion) {
                            // Deps version changed, check if actual value reverted (primitives only)
                            const storedValue = source.sv;
                            const storedType = typeof storedValue;
                            if (source.g && (storedValue === null || (storedType !== 'object' && storedType !== 'function'))) {
                                const currentValue = source.g();
                                if (Object.is(currentValue, storedValue)) {
                                    // Value reverted - update dv and continue checking
                                    source.dv = currentDepsVersion;
                                    continue;
                                }
                            }
                            // Value actually changed - mark DIRTY and skip remaining
                            stateSourceChanged = true;
                            break;
                        }
                    } else {
                        // Collect computed sources for verification (avoids second iteration)
                        // biome-ignore lint/suspicious/noAssignInExpressions: optimization
                        (computedSourcesToCheck ||= []).push(source);
                    }
                }

                if (stateSourceChanged || (computedSourcesToCheck && checkComputedSources(computedSourcesToCheck, true))) {
                    // Source changed or threw - mark DIRTY and proceed to recompute
                    self[flagsSymbol] = flags |= Flag.DIRTY;
                    break checkCache;
                }
            } else if (checkComputedSources(sourcesArray, true)) {
                // All sources are computed - directly check them without polling loop
                // Source changed or threw - mark DIRTY and proceed to recompute
                self[flagsSymbol] = flags |= Flag.DIRTY;
                break checkCache;
            }

            // No sources changed - return cached value
            self[lastGlobalVersionSymbol] = globalVersion;
            if (flags & Flag.HAS_ERROR) {
                throw self[valueSymbol];
            }
            return self[valueSymbol];
        }
    }

    // ===== PULL PHASE: Verify CHECK state for live computeds =====
    // Live computeds receive CHECK via push - verify sources before recomputing
    // Non-live computeds already verified above during polling
    // Note: Check for Flag.HAS_VALUE OR Flag.HAS_ERROR since cached errors should also use this path
    // Note: Using Flag.NEEDS_WORK instead of Flag.CHECK_ONLY since computeds never have Flag.EFFECT
    if ((flags & Flag.NEEDS_WORK) === Flag.CHECK && hasCached) {
        const result = checkComputedSources(sourcesArray);
        // If null, can't verify (has state sources or empty) - keep CHECK flag
        if (result !== null) {
            if (result) {
                // Sources changed or errored - mark DIRTY and let getter run
                // (getter may handle error differently, e.g. try/catch with fallback)
                self[flagsSymbol] = flags = (flags & ~Flag.CHECK) | Flag.DIRTY;
            } else {
                // Sources unchanged, clear CHECK flag and return cached value
                self[flagsSymbol] = flags & ~Flag.CHECK;
                self[lastGlobalVersionSymbol] = globalVersion;
                if (flags & Flag.HAS_ERROR) {
                    throw self[valueSymbol];
                }
                return self[valueSymbol];
            }
        }
    }

    // ===== PULL PHASE: Recompute value by pulling from sources =====
    // Recompute if dirty or check (sources actually changed)
    if (flags & Flag.NEEDS_WORK) {
        const wasDirty = (flags & Flag.DIRTY) !== 0;

        runWithTracking(self, () => {
            try {
                const newValue = self[getterSymbol]();

                // Check if value actually changed (common path: no error recovery)
                const changed = !(flags & Flag.HAS_VALUE) || !self[equalsSymbol](self[valueSymbol], newValue);

                if (changed) {
                    self[valueSymbol] = newValue;
                    // Increment version to indicate value changed (for polling)
                    self[versionSymbol]++;
                    self[flagsSymbol] = (self[flagsSymbol] | Flag.HAS_VALUE) & ~Flag.HAS_ERROR;
                    // ===== PUSH PHASE (during pull): Mark CHECK-only dependents as DIRTY =====
                    // When value changes during recomputation, upgrade dependent CHECK flags to DIRTY
                    for (const dep of self[dependencies] as Set<Computed<any>>) {
                        const depFlags = dep[flagsSymbol];
                        if ((depFlags & Flag.SKIP_NOTIFY) === Flag.CHECK) {
                            dep[flagsSymbol] = depFlags | Flag.DIRTY;
                        }
                    }
                } else if (wasDirty) {
                    self[flagsSymbol] |= Flag.HAS_VALUE;
                }

                // Update last seen global version
                self[lastGlobalVersionSymbol] = globalVersion;
            } catch (e) {
                // Per TC39 Signals proposal: cache the error and mark as clean with error flag
                // The error will be rethrown on subsequent reads until a dependency changes
                // Reuse valueSymbol for error storage since a computed can't have both value and error
                // Increment version since the result changed (to error)
                self[versionSymbol]++;
                self[valueSymbol] = e;
                self[flagsSymbol] = (self[flagsSymbol] & ~Flag.HAS_VALUE) | Flag.HAS_ERROR;
                self[lastGlobalVersionSymbol] = globalVersion;
            }
        });
    }

    // Check if we have a cached error to rethrow (stored in valueSymbol)
    if (self[flagsSymbol] & Flag.HAS_ERROR) {
        throw self[valueSymbol];
    }

    return self[valueSymbol];
}

/**
 * Creates a computed value that automatically tracks dependencies and caches results
 */
export const computed = <T>(getter: () => T, equals: (a: T, b: T) => boolean = Object.is): Computed<T> =>
    computedRead.bind({
        [sources]: [],
        [dependencies]: new Set(),
        [flagsSymbol]: Flag.DIRTY,
        [skippedDeps]: 0,
        [versionSymbol]: 0,
        [getterSymbol]: getter,
        [equalsSymbol]: equals,
    } as Computed<T>) as Computed<T>;