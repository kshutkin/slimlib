import { clearSources, trackDependency } from './core.js';
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
import { globalVersion } from './globals.js';
import {
    deps,
    depsTail,
    equalsSymbol,
    flagsSymbol,
    getterSymbol,
    lastGlobalVersionSymbol,
    subs,
    valueSymbol,
    versionSymbol,
} from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */

/**
 * @typedef {import('./core.js').Link} Link
 */

// Global state - moved here to avoid circular imports and improve locality
/** @type {Computed<any> | null} */
export let currentComputing = null;
export let tracked = true;

/**
 * @template T
 * Read function for computed nodes
 * @this {Computed<T>}
 * @returns {T}
 */
function computedRead() {
    // Track if someone is reading us
    if (tracked && currentComputing) {
        trackDependency(this, this[versionSymbol]);
    }

    let flags = this[flagsSymbol];

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

    // Track if we've already verified all sources are computed (to avoid redundant loop)
    let allComputedVerified = false;

    // For non-live computeds with stale globalVersion: poll sources to check if recomputation needed
    // This is the "pull" part of the push/pull algorithm - non-live nodes poll instead of receiving notifications
    if (!(flags & FLAG_NEEDS_WORK) && flags & (FLAG_HAS_VALUE | FLAG_HAS_ERROR) && !(flags & FLAG_IS_LIVE)) {
        // Check if we have any state sources (signal nodes have no flagsSymbol)
        let hasStateSources = false;
        let linkIter = this[deps];
        while (linkIter !== undefined) {
            if (linkIter.d[flagsSymbol] === undefined) {
                hasStateSources = true;
                break;
            }
            linkIter = linkIter.n;
        }

        if (hasStateSources) {
            this[flagsSymbol] = flags |= FLAG_DIRTY;
        } else {
            this[flagsSymbol] = flags |= FLAG_CHECK;
            allComputedVerified = true; // We just verified all sources are computed
        }
    }

    // For CHECK state, verify if sources actually changed before recomputing
    // This preserves the equality cutoff optimization with eager marking
    // Only do this for non-effects that ONLY have computed sources (with nodes)
    // Effects should always run when marked, and state deps have no node to check
    if ((flags & (FLAG_CHECK_ONLY | FLAG_HAS_VALUE)) === (FLAG_CHECK | FLAG_HAS_VALUE)) {
        // Check if all sources have flags (are computed, not signals)
        // Skip this loop if we already verified above (allComputedVerified)
        let allComputed = allComputedVerified;
        if (!allComputed) {
            allComputed = true;
            let linkIter = this[deps];
            while (linkIter !== undefined) {
                if (linkIter.d[flagsSymbol] === undefined) {
                    allComputed = false;
                    break;
                }
                linkIter = linkIter.n;
            }
        }

        // Only do source checking if we ONLY have computed sources
        // If we have state sources, we can't verify them - must recompute
        if (allComputed) {
            // Inline untracked to avoid function call overhead
            const prevTracked = tracked;
            tracked = false;
            let sourceChanged = false;
            try {
                let linkIter = this[deps];
                while (linkIter !== undefined) {
                    const sourceNode = /** @type {Computed<any>} */ (linkIter.d);
                    // Access source to trigger its recomputation if needed
                    sourceNode();
                    // Check if source version changed (meaning its value changed)
                    if (linkIter.v !== sourceNode[versionSymbol]) {
                        sourceChanged = true;
                        linkIter.v = sourceNode[versionSymbol];
                    }
                    linkIter = linkIter.n;
                }
            } finally {
                tracked = prevTracked;
            }
            // If source changed, mark as dirty to force recomputation
            // Otherwise, clear CHECK flag since sources are unchanged
            this[flagsSymbol] = flags = (flags & ~FLAG_CHECK) | (sourceChanged ? FLAG_DIRTY : 0);
        }
    }

    // Recompute if dirty or check (sources actually changed)
    // Note: FLAG_COMPUTING check is now redundant here since we throw above,
    // but kept for safety in case of future refactoring
    if (flags & FLAG_NEEDS_WORK) {
        const wasDirty = (flags & FLAG_DIRTY) !== 0;
        this[flagsSymbol] = (flags & ~FLAG_NEEDS_WORK) | FLAG_COMPUTING;

        // Reset depsTail for tracking - will be rebuilt during computation
        this[depsTail] = undefined;

        const prev = currentComputing;
        const prevTracked = tracked;
        currentComputing = this;
        tracked = true; // Computed always tracks its own dependencies

        try {
            const newValue = this[getterSymbol]();

            // Check if value actually changed (common path: no error recovery)
            const changed = !(flags & FLAG_HAS_VALUE) || !this[equalsSymbol](this[valueSymbol], newValue);

            if (changed) {
                this[valueSymbol] = newValue;
                // Increment version to indicate value changed (for polling)
                this[versionSymbol]++;
                this[flagsSymbol] = (this[flagsSymbol] | FLAG_HAS_VALUE) & ~FLAG_HAS_ERROR;
                // Mark CHECK-only dependents as DIRTY via subs linked list
                let linkIter = this[subs];
                while (linkIter !== undefined) {
                    const dep = linkIter.s;
                    const depFlags = dep[flagsSymbol];
                    if ((depFlags & (FLAG_COMPUTING | FLAG_NEEDS_WORK)) === FLAG_CHECK) {
                        dep[flagsSymbol] = depFlags | FLAG_DIRTY;
                    }
                    linkIter = linkIter.x;
                }
            } else if (wasDirty) {
                this[flagsSymbol] |= FLAG_HAS_VALUE;
            }

            this[flagsSymbol] &= ~FLAG_COMPUTING;

            // Update last seen global version
            this[lastGlobalVersionSymbol] = globalVersion;
        } catch (e) {
            // Per TC39 Signals proposal: cache the error and mark as clean with error flag
            // The error will be rethrown on subsequent reads until a dependency changes
            // Reuse valueSymbol for error storage since a computed can't have both value and error
            // Increment version since the result changed (to error)
            this[versionSymbol]++;
            this[valueSymbol] = e;
            this[flagsSymbol] = (this[flagsSymbol] & ~(FLAG_COMPUTING | FLAG_NEEDS_WORK | FLAG_HAS_VALUE)) | FLAG_HAS_ERROR;
            this[lastGlobalVersionSymbol] = globalVersion;
        } finally {
            currentComputing = prev;
            tracked = prevTracked;
            // Update source versions now that all sources have computed
            // This ensures we capture the version AFTER recomputation, not before
            let linkIter = this[deps];
            const tail = this[depsTail];
            while (linkIter !== undefined) {
                const dep = linkIter.d;
                // Only update version for computed sources (those with versionSymbol)
                if (dep[versionSymbol] !== undefined) {
                    linkIter.v = dep[versionSymbol];
                }
                // Stop at depsTail - everything after is stale
                if (linkIter === tail) {
                    break;
                }
                linkIter = linkIter.n;
            }
            // Clean up any stale sources that weren't reused
            clearSources(this);
        }
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

    // Initialize other properties
    context[flagsSymbol] = FLAG_DIRTY;
    context[getterSymbol] = getter;
    context[equalsSymbol] = equals;
    context[versionSymbol] = 0;

    return context;
};

/**
 * Execute without tracking dependencies
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
export const untracked = callback => {
    const prevTracked = tracked;
    tracked = false;
    try {
        return callback();
    } finally {
        tracked = prevTracked;
    }
};
