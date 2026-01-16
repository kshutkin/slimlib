import { checkComputedSources, currentComputing, globalVersion, runWithTracking, trackDependency, tracked } from './core.js';
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
    // Track if someone is reading us
    if (tracked && currentComputing) {
        trackDependency(this[dependencies], this);
    }

    let flags = this[flagsSymbol];
    const sourcesArray = this[sources];

    // Cycle detection: if this computed is already being computed, we have a cycle
    // This matches TC39 Signals proposal behavior: throw an error on cyclic reads
    if (flags & FLAG_COMPUTING) {
        throw new Error('Detected cycle in computations.');
    }

    // Fast-path: if node is clean, has a cached result, and nothing has changed globally since last read
    if (!(flags & FLAG_NEEDS_WORK) && flags & (FLAG_HAS_VALUE | FLAG_HAS_ERROR) && this[lastGlobalVersionSymbol] === globalVersion) {
        // If we have a cached error, rethrow it (stored in valueSymbol)
        if (flags & FLAG_HAS_ERROR) {
            throw this[valueSymbol];
        }
        return this[valueSymbol];
    }

    // For non-live computeds with stale globalVersion: poll sources to check if recomputation needed
    // This is the "pull" part of the push/pull algorithm - non-live nodes poll instead of receiving notifications
    if (!(flags & FLAG_NEEDS_WORK) && flags & (FLAG_HAS_VALUE | FLAG_HAS_ERROR) && !(flags & FLAG_IS_LIVE)) {
        let stateSourceChanged = false;
        let hasComputedSources = false;

        // Check all sources - both state and computed
        for (const source of sourcesArray) {
            if (!source.n) {
                // State source - check if deps version changed
                const currentDepsVersion = source.d[depsVersionSymbol] || 0;
                if (source.dv !== currentDepsVersion) {
                    // Deps version changed, but check if actual value is the same (revert detection)
                    // Only use value comparison for primitives - objects/arrays are mutable
                    // so same reference doesn't mean same content
                    const storedValue = source.sv;
                    const storedType = typeof storedValue;
                    if (source.g && (storedValue === null || (storedType !== 'object' && storedType !== 'function'))) {
                        const currentValue = source.g();
                        if (Object.is(currentValue, storedValue)) {
                            // Value reverted to original - update dv to current version
                            source.dv = currentDepsVersion;
                            continue;
                        }
                    }
                    // Value actually changed (or is object/array that might have mutated)
                    stateSourceChanged = true;
                    break;
                }
            } else {
                hasComputedSources = true;
            }
        }

        if (stateSourceChanged) {
            // A state source definitely changed - mark DIRTY
            this[flagsSymbol] = flags |= FLAG_DIRTY;
        } else if (hasComputedSources) {
            // No state source changed, but we have computed sources - mark CHECK to verify them
            this[flagsSymbol] = flags |= FLAG_CHECK;
        }
        // If no state source changed and no computed sources, node stays clean
    }

    // For CHECK state, verify if sources actually changed before recomputing
    // This preserves the equality cutoff optimization with eager marking
    // Only do this for non-effects that ONLY have computed sources (with nodes)
    // Effects should always run when marked, and state deps have no node to check
    if ((flags & (FLAG_CHECK_ONLY | FLAG_HAS_VALUE)) === (FLAG_CHECK | FLAG_HAS_VALUE)) {
        const needsRecompute = checkComputedSources(sourcesArray);
        // If null, can't verify (has state sources or empty) - keep CHECK flag
        // If true, mark as dirty to force recomputation
        // If false, clear CHECK flag since sources are unchanged
        if (needsRecompute !== null) {
            this[flagsSymbol] = flags = (flags & ~FLAG_CHECK) | (needsRecompute ? FLAG_DIRTY : 0);
        }
    }

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
                    // Mark CHECK-only dependents as DIRTY
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
