/**
 * Core reactive system implementation using push/pull algorithm:
 *
 * PUSH PHASE: When a source value changes (signal/state write):
 *   - Increment globalVersion
 *   - Eagerly propagate CHECK flags to all dependents
 *   - Schedule effects for execution
 *
 * PULL PHASE: When a computed/effect is read:
 *   - Check if recomputation is needed (via flags and source versions)
 *   - Lazily recompute by pulling values from sources
 *   - Update cached value and version
 */

import { computedRead } from './computed.js';
import { safeForEach } from './debug.js';
import {
    FLAG_CHECK,
    FLAG_COMPUTING,
    FLAG_COMPUTING_EFFECT,
    FLAG_DIRTY,
    FLAG_EFFECT,
    FLAG_HAS_STATE_SOURCE,
    FLAG_IS_LIVE,
    FLAG_LIVE,
    FLAG_NEEDS_WORK,
    FLAG_SKIP_NOTIFY,
} from './flags.js';
import { scheduler } from './globals.js';
import { dependencies, depsVersionSymbol, flagsSymbol, skippedDeps, sources, unwrap, versionSymbol } from './symbols.js';

export { depsVersionSymbol };

/**
 * A computed value that can be part of the batched set
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any, i?: number }} Computed
 */

let flushScheduled = false;

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 0;

/** @type {Set<Computed<any>>} */
export let batched = new Set();

/** @type {number} */
let lastAddedId = 0;

/** @type {boolean} */
let needsSort = false;

// Computation tracking state
/** @type {Computed<any> | null} */

export let currentComputing = null;
export let tracked = true;

/**
 * Add an effect to the batched set
 * PUSH PHASE: Part of effect scheduling during dirty propagation
 * Caller must check FLAG_NEEDS_WORK before calling to avoid duplicates
 * @param {Computed<any>} node
 */
export const batchedAdd = node => {
    const nodeId = /** @type {number} */ (node.i);
    // Track if we're adding out of order
    if (nodeId < lastAddedId) {
        needsSort = true;
    }
    lastAddedId = nodeId;
    batched.add(node);
};

/**
 * Add a newly created effect to the batched set
 * Used during effect creation - new effects always have the highest ID
 * so we unconditionally update lastAddedId without checking order
 * @param {Computed<any>} node
 * @param {number} effectId
 */
export const batchedAddNew = (node, effectId) => {
    lastAddedId = effectId;
    batched.add(node);
};

/**
 * Unwraps a proxied value to get the underlying object
 * (Utility - not specific to push/pull phases)
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const unwrapValue = value => (value != null && /** @type {Record<symbol, any>} */ (/** @type {unknown} */ (value))[unwrap]) || value;

/**
 * Make a computed live - register it with all its sources
 * Called when a live consumer starts reading this computed
 * PUSH PHASE: Enables push notifications to flow through this node
 * @param {Computed<any>} node
 */
export const makeLive = node => {
    node[flagsSymbol] |= FLAG_LIVE;
    for (const { d: deps, n: sourceNode } of node[sources]) {
        deps.add(node);
        if (sourceNode && !(sourceNode[flagsSymbol] & FLAG_IS_LIVE)) {
            makeLive(sourceNode);
        }
    }
};

/**
 * Make a computed non-live - unregister it from all its sources
 * Called when all live consumers stop depending on this computed
 * PUSH PHASE: Disables push notifications through this node
 * @param {Computed<any>} node
 */
export const makeNonLive = node => {
    node[flagsSymbol] &= ~FLAG_LIVE;
    for (const { d: deps, n: sourceNode } of node[sources]) {
        deps.delete(node);
        const sourceNodeFlag = sourceNode?.[flagsSymbol];
        // Check: has FLAG_LIVE but not FLAG_EFFECT (effects never become non-live)
        if ((sourceNodeFlag & FLAG_IS_LIVE) === FLAG_LIVE && !sourceNode[dependencies].size) {
            makeNonLive(sourceNode);
        }
    }
};

/**
 * Clear sources for a node starting from a specific index
 * PULL PHASE: Cleanup during dependency tracking when sources change
 * @param {Computed<any>} node
 * @param {number} fromIndex - Index to start clearing from (default 0 clears all)
 */
export const clearSources = (node, fromIndex = 0) => {
    const sourcesArray = node[sources];
    const isLive = node[flagsSymbol] & FLAG_IS_LIVE;

    for (let i = fromIndex; i < sourcesArray.length; i++) {
        const { d: deps, n: sourceNode } = sourcesArray[i];

        // Check if this deps is retained (exists in kept portion) - avoid removing shared deps
        let retained = false;
        for (let j = 0; j < fromIndex && !retained; j++) {
            retained = sourcesArray[j].d === deps;
        }

        if (!retained) {
            // Always remove from deps to prevent stale notifications
            deps.delete(node);
            // If source is a computed and we're live, check if it became non-live
            if (isLive) {
                const sourceNodeFlag = sourceNode?.[flagsSymbol];
                // Check: has FLAG_LIVE but not FLAG_EFFECT (effects never become non-live)
                if ((sourceNodeFlag & FLAG_IS_LIVE) === FLAG_LIVE && !sourceNode[dependencies].size) {
                    makeNonLive(sourceNode);
                }
            }
        }
    }
    sourcesArray.length = fromIndex;
};

/**
 * Execute all pending effects immediately
 * This function can be called to manually trigger all scheduled effects
 * before the next microtask
 * PULL PHASE: Executes batched effects, each effect pulls its dependencies
 */
export const flushEffects = () => {
    flushScheduled = false;
    // Collect nodes, only sort if effects were added out of order
    /** @type {Computed<any>[]} */
    const nodes = [...batched];
    if (needsSort) {
        nodes.sort((a, b) => /** @type {number} */ (a.i) - /** @type {number} */ (b.i));
    }
    batched = new Set();
    lastAddedId = 0;
    needsSort = false;
    safeForEach(nodes);
};

/**
 * Schedule flush via scheduler (default: microtask)
 * PUSH PHASE: Schedules the transition from push to pull phase
 */
export const scheduleFlush = () => {
    if (!flushScheduled) {
        flushScheduled = true;
        scheduler(flushEffects);
    }
};

/**
 * Track a dependency between currentComputing and a deps Set
 * Uses liveness tracking - only live consumers register with sources
 * PULL PHASE: Records dependencies during computation for future invalidation
 * @param {Set<Computed<any>>} deps - The dependency set to track
 * @param {Computed<any>} [sourceNode] - The computed node being accessed (if any)
 * @param {() => any} [valueGetter] - Function to get current source value (for signal/state polling)
 */
export const trackDependency = (deps, sourceNode, valueGetter) => {
    // Callers guarantee tracked && currentComputing are true
    const node = /** @type {Computed<any>} */ (currentComputing);
    const sourcesArray = node[sources];
    const skipIndex = node[skippedDeps];

    if (sourcesArray[skipIndex]?.d !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(node, skipIndex);
        }

        // Push source entry - version will be updated after source computes
        // For state sources (no node), track deps version, value getter, and last seen value for polling
        const currentValue = valueGetter?.();
        sourcesArray.push({
            d: deps,
            n: sourceNode,
            v: 0,
            dv: /** @type {any} */ (deps)[depsVersionSymbol] || 0,
            g: valueGetter,
            sv: currentValue,
        });

        // Mark that this node has state/signal sources (for polling optimization)
        if (!sourceNode) {
            node[flagsSymbol] |= FLAG_HAS_STATE_SOURCE;
        }

        // Only register with source if we're live
        if (node[flagsSymbol] & FLAG_IS_LIVE) {
            deps.add(node);
            // If source is a computed that's not live, make it live
            if (sourceNode && !(sourceNode[flagsSymbol] & FLAG_IS_LIVE)) {
                makeLive(sourceNode);
            }
        }
    } else if (!sourceNode && valueGetter) {
        // Same state source - update dv, g, and sv for accurate polling
        const entry = sourcesArray[skipIndex];
        entry.dv = /** @type {any} */ (deps)[depsVersionSymbol] || 0;
        entry.g = valueGetter;
        entry.sv = valueGetter();
        // Re-set FLAG_HAS_STATE_SOURCE (may have been cleared by runWithTracking)
        node[flagsSymbol] |= FLAG_HAS_STATE_SOURCE;
    }
    ++node[skippedDeps];
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * PUSH PHASE: Eagerly propagates CHECK flag up the dependency graph
 * @param {Computed<any>} node
 */
export const markNeedsCheck = node => {
    const flags = node[flagsSymbol];
    if ((flags & FLAG_COMPUTING_EFFECT) === FLAG_COMPUTING_EFFECT) {
        if (!(flags & FLAG_DIRTY)) {
            node[flagsSymbol] = flags | FLAG_DIRTY;
            batchedAdd(node);
            scheduleFlush();
        }
    } else if (!(flags & FLAG_SKIP_NOTIFY)) {
        node[flagsSymbol] = flags | FLAG_CHECK;
        if (flags & FLAG_EFFECT) {
            batchedAdd(node);
            scheduleFlush();
        }
        const deps = node[dependencies];
        if (deps) {
            for (const dep of deps) {
                markNeedsCheck(dep);
            }
        }
    }
};

/**
 * Mark all dependents in a Set as needing check
 * PUSH PHASE: Entry point for push propagation when a source value changes
 * @param {Set<Computed<any>>} deps - The dependency set to notify
 */
export const markDependents = deps => {
    ++globalVersion;
    // Increment deps version for non-live computed polling
    /** @type {any} */ (deps)[depsVersionSymbol] = /** @type {any} */ (deps[depsVersionSymbol] || 0) + 1;
    for (const dep of deps) {
        markNeedsCheck(dep);
    }
};

/**
 * Run a getter function with dependency tracking
 * Handles cycle detection, context setup, and source cleanup
 * PULL PHASE: Core of pull - executes computation while tracking dependencies
 * @template T
 * @param {Computed<any>} node - The node being computed
 * @param {() => T} getter - The getter function to run
 * @returns {T} The result of the getter
 */
export const runWithTracking = (node, getter) => {
    // Clear FLAG_NEEDS_WORK and FLAG_HAS_STATE_SOURCE (will be recalculated during tracking)
    // Note: Even when called from checkComputedSources (which sets tracked=false), this works
    // because runWithTracking sets tracked=true, so trackDependency will re-set the flag
    node[flagsSymbol] = (node[flagsSymbol] & ~(FLAG_NEEDS_WORK | FLAG_HAS_STATE_SOURCE)) | FLAG_COMPUTING;
    node[skippedDeps] = 0;

    const prev = currentComputing;
    const prevTracked = tracked;
    currentComputing = node;
    tracked = true;

    try {
        return getter();
    } finally {
        currentComputing = prev;
        tracked = prevTracked;
        node[flagsSymbol] &= ~FLAG_COMPUTING;
        const sourcesArray = node[sources];
        const skipped = node[skippedDeps];
        const updateLen = Math.min(skipped, sourcesArray.length);
        for (let i = 0; i < updateLen; i++) {
            const entry = sourcesArray[i];
            if (entry.n) {
                entry.v = entry.n[versionSymbol];
            }
            // Note: state source dv and sv are updated when trackDependency is called during recomputation
        }
        // Clean up any excess sources that weren't reused
        if (sourcesArray.length > skipped) {
            clearSources(node, skipped);
        }
    }
};

/**
 * Execute a callback without tracking any reactive dependencies
 * Useful when reading signals/state without creating a dependency relationship
 * PULL PHASE: Temporarily disables dependency tracking during pull
 * @template T
 * @param {() => T} callback - Function to execute without tracking
 * @returns {T} The return value of the callback
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

/**
 * Check if any computed sources have changed or errored.
 * Used by CHECK path optimization in computed and effect.
 * PULL PHASE: Verifies if sources actually changed before recomputing (equality cutoff)
 * @param {Array<{d: Set<Computed<any>>, n: Computed<any>, v: number, dv: number, g?: () => any, sv?: any}>} sourcesArray
 * @param {boolean} [skipStateCheck=false] - If true, skip checking for state sources (caller guarantees all are computed)
 * @returns {boolean | null} true if changed or errored, false if unchanged, null if can't verify (has state sources or empty)
 */
export const checkComputedSources = (sourcesArray, skipStateCheck = false) => {
    let changed = false;
    const prevTracked = tracked;
    tracked = false;
    for (const sourceEntry of sourcesArray) {
        const sourceNode = sourceEntry.n;
        // Check for state source (no .n) - can't verify, bail out
        if (!skipStateCheck && !sourceNode) {
            tracked = prevTracked;
            return null;
        }
        // Access source to trigger its recomputation if needed
        try {
            computedRead.call(sourceNode);
        } catch {
            // Error counts as changed - caller will recompute and may handle differently
            tracked = prevTracked;
            return true;
        }
        // Check if source version changed (meaning its value changed)
        if (sourceEntry.v !== sourceNode[versionSymbol]) {
            changed = true;
            sourceEntry.v = sourceNode[versionSymbol];
        }
    }
    tracked = prevTracked;
    return changed;
};
