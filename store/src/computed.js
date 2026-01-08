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
import { currentComputing, globalVersion, setCurrentComputing, setTracked, tracked } from './globals.js';
import {
    dependencies,
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

    const len = sourcesArray.length;

    // For non-live computeds with stale globalVersion: poll sources to check if recomputation needed
    // This is the "pull" part of the push/pull algorithm - non-live nodes poll instead of receiving notifications
    if (!(flags & FLAG_NEEDS_WORK) && flags & (FLAG_HAS_VALUE | FLAG_HAS_ERROR) && !(flags & FLAG_IS_LIVE)) {
        // Check if we have any state sources (no node means state/signal source)
        let hasStateSources = false;
        for (const source of sourcesArray) {
            if (!source.n) {
                hasStateSources = true;
                break;
            }
        }

        this[flagsSymbol] = flags |= hasStateSources ? FLAG_DIRTY : FLAG_CHECK;
    }

    // For CHECK state, verify if sources actually changed before recomputing
    // This preserves the equality cutoff optimization with eager marking
    // Only do this for non-effects that ONLY have computed sources (with nodes)
    // Effects should always run when marked, and state deps have no node to check
    if ((flags & (FLAG_CHECK_ONLY | FLAG_HAS_VALUE)) === (FLAG_CHECK | FLAG_HAS_VALUE)) {
        // Fast path: check if all sources have nodes (are computed, not state)
        // Do this inline to avoid separate loop
        let allComputed = len > 0;
        for (let i = 0; i < len && allComputed; i++) {
            if (!sourcesArray[i].n) {
                allComputed = false;
            }
        }

        // Only do source checking if we ONLY have computed sources
        // If we have state sources, we can't verify them - must recompute
        if (allComputed) {
            // Inline untracked to avoid function call overhead
            const prevTracked = tracked;
            setTracked(false);
            let sourceChanged = false;
            try {
                for (const sourceEntry of sourcesArray) {
                    const sourceNode = sourceEntry.n;
                    // Access source to trigger its recomputation if needed
                    sourceNode();
                    // Check if source version changed (meaning its value changed)
                    if (sourceEntry.v !== sourceNode[versionSymbol]) {
                        sourceChanged = true;
                        sourceEntry.v = sourceNode[versionSymbol];
                    }
                }
            } finally {
                setTracked(prevTracked);
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

        // Reset skipped deps counter for this recomputation
        this[skippedDeps] = 0;

        const prev = currentComputing;
        const prevTracked = tracked;
        setCurrentComputing(this);
        setTracked(true); // Computed always tracks its own dependencies

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
            setCurrentComputing(prev);
            setTracked(prevTracked);
            // Update source versions now that all sources have computed
            // This ensures we capture the version AFTER recomputation, not before
            const skipped = this[skippedDeps];
            const updateLen = Math.min(skipped, sourcesArray.length);
            for (let i = 0; i < updateLen; i++) {
                const entry = sourcesArray[i];
                if (entry.n) {
                    entry.v = entry.n[versionSymbol];
                }
            }
            // Clean up any excess sources that weren't reused
            if (sourcesArray.length > skipped) {
                clearSources(this, skipped);
            }
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

    // Initialize all properties directly on the callable (no prototype needed)
    context[sources] = [];
    context[dependencies] = new Set();
    context[flagsSymbol] = FLAG_DIRTY;
    context[skippedDeps] = 0;
    context[getterSymbol] = getter;
    context[equalsSymbol] = equals;
    context[versionSymbol] = 0;

    return context;
};
