import { checkComputedSources, currentComputing, globalVersion, runWithTracking, trackDependency, tracked } from './core.js';
import { cycleMessage } from './debug.js';
import {
    FLAG_CHECK,
    FLAG_CHECK_ONLY,
    FLAG_COMPUTING,
    FLAG_DIRTY,
    FLAG_HAS_ERROR,
    FLAG_HAS_VALUE,
    FLAG_IS_LIVE,
    FLAG_NEEDS_WORK,
} from './flags.js';
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
} from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */

/**
 * @template T
 * Read function for computed nodes
 * @this {Computed<T>}
 * @returns {T}
 */
function computedRead() {
    // ===== PULL PHASE: Register this computed as a dependency of the current consumer =====
    // Track if someone is reading us
    if (tracked && currentComputing) {
        trackDependency(this[dependencies], this);
    }

    let flags = this[flagsSymbol];
    const sourcesArray = this[sources];

    // Cycle detection: if this computed is already being computed, we have a cycle
    // This matches TC39 Signals proposal behavior: throw an error on cyclic reads
    if (flags & FLAG_COMPUTING) {
        throw new Error(cycleMessage);
    }

    // ===== PULL PHASE: Check if cached value can be returned =====
    // Combined check: node has cached result and doesn't need work
    const hasCached = flags & (FLAG_HAS_VALUE | FLAG_HAS_ERROR);
    if (!(flags & FLAG_NEEDS_WORK) && hasCached) {
        // Fast-path: nothing has changed globally since last read
        if (this[lastGlobalVersionSymbol] === globalVersion) {
            if (flags & FLAG_HAS_ERROR) {
                throw this[valueSymbol];
            }
            return this[valueSymbol];
        }

        // ===== PULL PHASE: Poll sources for non-live computeds =====
        // Non-live nodes poll instead of receiving push notifications
        if (!(flags & FLAG_IS_LIVE)) {
            // Single pass: check state sources AND collect computed sources
            let stateSourceChanged = false;
            /** @type {Array<{d: Set<import('./index.js').Computed<any>>, n: import('./index.js').Computed<any>, v: number, dv: number, g?: () => any, sv?: any}> | null} */
            let computedSourcesToCheck = null;

            for (const source of sourcesArray) {
                if (!source.n) {
                    // State source - check if deps version changed
                    const currentDepsVersion = source.d[depsVersionSymbol] || 0;
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

            if (stateSourceChanged) {
                // State source changed - mark DIRTY and proceed to recompute
                this[flagsSymbol] = flags |= FLAG_DIRTY;
            } else if (computedSourcesToCheck) {
                // Verify computed sources using shared function (skipStateCheck=true since pre-filtered)
                const result = checkComputedSources(computedSourcesToCheck, true);
                if (result) {
                    // Source threw or changed - mark DIRTY and let getter run
                    // (getter may handle error differently, e.g. try/catch with fallback)
                    this[flagsSymbol] = flags |= FLAG_DIRTY;
                } else {
                    // No sources changed - return cached value
                    this[lastGlobalVersionSymbol] = globalVersion;
                    if (flags & FLAG_HAS_ERROR) {
                        throw this[valueSymbol];
                    }
                    return this[valueSymbol];
                }
            } else {
                // No sources or all state sources unchanged - return cached
                this[lastGlobalVersionSymbol] = globalVersion;
                if (flags & FLAG_HAS_ERROR) {
                    throw this[valueSymbol];
                }
                return this[valueSymbol];
            }
        }
    }

    // ===== PULL PHASE: Verify CHECK state for live computeds =====
    // Live computeds receive CHECK via push - verify sources before recomputing
    // Non-live computeds already verified above during polling
    // Note: Check for FLAG_HAS_VALUE OR FLAG_HAS_ERROR since cached errors should also use this path
    if ((flags & FLAG_CHECK_ONLY) === FLAG_CHECK && hasCached) {
        const result = checkComputedSources(sourcesArray);
        // If null, can't verify (has state sources or empty) - keep CHECK flag
        if (result !== null) {
            if (result) {
                // Sources changed or errored - mark DIRTY and let getter run
                // (getter may handle error differently, e.g. try/catch with fallback)
                this[flagsSymbol] = flags = (flags & ~FLAG_CHECK) | FLAG_DIRTY;
            } else {
                // Sources unchanged, clear CHECK flag and return cached value
                this[flagsSymbol] = flags & ~FLAG_CHECK;
                this[lastGlobalVersionSymbol] = globalVersion;
                if (flags & FLAG_HAS_ERROR) {
                    throw this[valueSymbol];
                }
                return this[valueSymbol];
            }
        }
    }

    // ===== PULL PHASE: Recompute value by pulling from sources =====
    // Recompute if dirty or check (sources actually changed)
    if (flags & FLAG_NEEDS_WORK) {
        const wasDirty = (flags & FLAG_DIRTY) !== 0;

        runWithTracking(this, () => {
            try {
                const newValue = this[getterSymbol]();

                // Check if value actually changed (common path: no error recovery)
                const changed = !(flags & FLAG_HAS_VALUE) || !this[equalsSymbol](this[valueSymbol], newValue);

                if (changed) {
                    this[valueSymbol] = newValue;
                    // Increment version to indicate value changed (for polling)
                    this[versionSymbol]++;
                    this[flagsSymbol] = (this[flagsSymbol] | FLAG_HAS_VALUE) & ~FLAG_HAS_ERROR;
                    // ===== PUSH PHASE (during pull): Mark CHECK-only dependents as DIRTY =====
                    // When value changes during recomputation, upgrade dependent CHECK flags to DIRTY
                    for (const dep of this[dependencies]) {
                        const depFlags = dep[flagsSymbol];
                        if ((depFlags & (FLAG_COMPUTING | FLAG_NEEDS_WORK)) === FLAG_CHECK) {
                            dep[flagsSymbol] = depFlags | FLAG_DIRTY;
                        }
                    }
                } else if (wasDirty) {
                    this[flagsSymbol] |= FLAG_HAS_VALUE;
                }

                // Update last seen global version
                this[lastGlobalVersionSymbol] = globalVersion;
            } catch (e) {
                // Per TC39 Signals proposal: cache the error and mark as clean with error flag
                // The error will be rethrown on subsequent reads until a dependency changes
                // Reuse valueSymbol for error storage since a computed can't have both value and error
                // Increment version since the result changed (to error)
                this[versionSymbol]++;
                this[valueSymbol] = e;
                this[flagsSymbol] = (this[flagsSymbol] & ~(FLAG_HAS_VALUE)) | FLAG_HAS_ERROR;
                this[lastGlobalVersionSymbol] = globalVersion;
            }
        });
    }

    // Check if we have a cached error to rethrow (stored in valueSymbol)
    if (this[flagsSymbol] & FLAG_HAS_ERROR) {
        throw this[valueSymbol];
    }

    return this[valueSymbol];
}

/**
 * Creates a computed value that automatically tracks dependencies and caches results
 * @template T
 * @param {() => T} getter
 * @param {(a: T, b: T) => boolean} [equals=Object.is] - Equality comparison function
 * @returns {Computed<T>}
 */
export const computed = (getter, equals = Object.is) => {
    // Create callable that invokes computedRead with itself as `this`
    const context = /** @type {Computed<T>} */ (() => computedRead.call(context));

    // Initialize all properties directly on the callable (no prototype needed)
    context[sources] = [];
    context[dependencies] = new Set;
    context[flagsSymbol] = FLAG_DIRTY;
    context[skippedDeps] = 0;
    context[getterSymbol] = getter;
    context[equalsSymbol] = equals;
    context[versionSymbol] = 0;

    return context;
};