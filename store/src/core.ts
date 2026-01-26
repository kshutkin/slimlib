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

import { computedRead } from './computed';
import { Flag } from './flags';
import { scheduler } from './globals';
import { unwrap } from './symbols';
import type { ComputedSourceEntry, DepsSet, ReactiveNode, SourceEntry, StateSourceEntry } from './internal-types';
import { safeForEach } from './debug';

let flushScheduled = false;

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 1;

export const batched: ReactiveNode[] = [];

let lastAddedId = 0;

let needsSort = false;

// Computation tracking state
export let currentComputing: ReactiveNode | undefined;
export let tracked = true;

/**
 * Set the tracked state for dependency tracking (internal use only)
 * Returns the previous tracked state for restoration
 */
export const setTracked = (value: boolean): boolean => {
    const prev = tracked;
    tracked = value;
    return prev;
};

/**
 * Add an effect to the batched set
 * PUSH PHASE: Part of effect scheduling during dirty propagation
 * Caller must check Flag.NEEDS_WORK before calling to avoid duplicates
 */
export const batchedAdd = (node: ReactiveNode): void => {
    const nodeId = node.$_id as number;
    // Track if we're adding out of order
    if (nodeId < lastAddedId) {
        needsSort = true;
    }
    lastAddedId = nodeId;
    batched.push(node);
};

/**
 * Add a newly created effect to the batched set
 * Used during effect creation - new effects always have the highest ID
 * so we unconditionally update lastAddedId without checking order
 */
export const batchedAddNew = (node: ReactiveNode, effectId: number): void => {
    lastAddedId = effectId;
    batched.push(node);
};

/**
 * Unwraps a proxied value to get the underlying object
 * (Utility - not specific to push/pull phases)
 */
export const unwrapValue = <T>(value: T): T =>
    ((value !== null && (typeof value === "object" || typeof value === "function") && (value as unknown as Record<symbol, unknown>)[unwrap] as T) ||
        value);

/**
 * Make a computed live - register it with all its sources
 * Called when a live consumer starts reading this computed
 * PUSH PHASE: Enables push notifications to flow through this node
 */
export const makeLive = (node: ReactiveNode): void => {
    node.$_flags |= Flag.LIVE;
    for (let i = 0, len = node.$_sources.length; i < len; ++i) {
        const { $_dependents, $_node: sourceNode } = node.$_sources[i] as SourceEntry;
        $_dependents.add(node);
        if (sourceNode && (sourceNode.$_flags & (Flag.EFFECT | Flag.LIVE)) === 0) {
            makeLive(sourceNode);
        }
    }
};

/**
 * Make a computed non-live - unregister it from all its sources
 * Called when all live consumers stop depending on this computed
 * PUSH PHASE: Disables push notifications through this node
 */
export const makeNonLive = (node: ReactiveNode): void => {
    node.$_flags &= ~Flag.LIVE;
    for (let i = 0, len = node.$_sources.length; i < len; ++i) {
        const { $_dependents, $_node: sourceNode } = node.$_sources[i] as SourceEntry;
        $_dependents.delete(node);
        // Check: has Flag.LIVE but not Flag.EFFECT (effects never become non-live)
        if (sourceNode && (sourceNode.$_flags & (Flag.EFFECT | Flag.LIVE)) === Flag.LIVE && !(sourceNode.$_deps as Set<ReactiveNode>).size) {
            makeNonLive(sourceNode);
        }
    }
};

/**
 * Clear sources for a node starting from a specific index
 * PULL PHASE: Cleanup during dependency tracking when sources change
 */
export const clearSources = (node: ReactiveNode, fromIndex = 0): void => {
    const sourcesArray = node.$_sources;
    const isLive = (node.$_flags & (Flag.EFFECT | Flag.LIVE)) !== 0;
    const len = sourcesArray.length;

    for (let i = fromIndex; i < len; ++i) {
        const { $_dependents, $_node: sourceNode } = sourcesArray[i] as SourceEntry;

        // Check if this deps is retained (exists in kept portion) - avoid removing shared deps
        let retained = false;
        for (let j = 0; j < fromIndex && !retained; j++) {
            retained = (sourcesArray[j] as SourceEntry).$_dependents === $_dependents;
        }

        if (!retained) {
            // Always remove from deps to prevent stale notifications
            $_dependents.delete(node);
            // If source is a computed and we're live, check if it became non-live
            if (isLive && sourceNode && (sourceNode.$_flags & (Flag.EFFECT | Flag.LIVE)) === Flag.LIVE && !(sourceNode.$_deps as Set<ReactiveNode>).size) {
                makeNonLive(sourceNode);
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
export const flushEffects = (): void => {
    flushScheduled = false;
    // Collect nodes, only sort if effects were added out of order
    // Use a copy of the array for execution to allow re-scheduling
    const nodes = batched.slice();
    batched.length = 0;

    if (needsSort) {
        nodes.sort((a, b) => (a.$_id as number) - (b.$_id as number));
    }

    lastAddedId = 0;
    needsSort = false;

    safeForEach(nodes);
};

/**
 * Schedule flush via scheduler (default: microtask)
 * PUSH PHASE: Schedules the transition from push to pull phase
 */
export const scheduleFlush = (): void => {
    if (!flushScheduled) {
        flushScheduled = true;
        scheduler(flushEffects);
    }
};

/**
 * Track a state/signal dependency between currentComputing and a deps Set
 * Uses liveness tracking - only live consumers register with sources
 * PULL PHASE: Records dependencies during computation for future invalidation
 */
export const trackStateDependency = <T>(
    deps: DepsSet<ReactiveNode>,
    valueGetter: () => T,
    cachedValue: T
): void => {
    // Callers guarantee tracked && currentComputing are true

    const sourcesArray = (currentComputing as ReactiveNode).$_sources;
    const skipIndex = (currentComputing as ReactiveNode).$_skipped;

    if (sourcesArray[skipIndex]?.$_dependents !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(currentComputing as ReactiveNode, skipIndex);
        }

        // Track deps version, value getter, and last seen value for polling
        sourcesArray.push({
            $_dependents: deps,
            $_node: undefined,
            $_version: (deps as DepsSet<ReactiveNode>).$_version || 0,
            $_getter: valueGetter,
            $_storedValue: cachedValue,
        } as StateSourceEntry<T>);

        // Mark that this node has state/signal sources (for polling optimization)
        (currentComputing as ReactiveNode).$_flags |= Flag.HAS_STATE_SOURCE;

        // Only register with source if we're live
        if (((currentComputing as ReactiveNode).$_flags & (Flag.EFFECT | Flag.LIVE)) !== 0) {
            deps.add(currentComputing as ReactiveNode);
        }
    } else {
        // Same state source - update depsVersion, getter, and storedValue for accurate polling
        const entry = sourcesArray[skipIndex] as StateSourceEntry<T>;
        entry.$_version = (deps as DepsSet<ReactiveNode>).$_version || 0;
        entry.$_getter = valueGetter;
        entry.$_storedValue = cachedValue;
        // Re-set Flag.HAS_STATE_SOURCE (may have been cleared by runWithTracking)
        (currentComputing as ReactiveNode).$_flags |= Flag.HAS_STATE_SOURCE;
    }
    ++(currentComputing as ReactiveNode).$_skipped;
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * PUSH PHASE: Eagerly propagates CHECK flag up the dependency graph
 */
export const markNeedsCheck = (node: ReactiveNode): void => {
    const flags = node.$_flags;
    // Fast path: skip if already computing, dirty, or marked CHECK
    // (COMPUTING | DIRTY | CHECK) (bits 0, 1, 2)
    if ((flags & (Flag.COMPUTING | Flag.DIRTY | Flag.CHECK)) !== 0) {
        // Exception: computing effect that's not dirty yet needs to be marked dirty
        // Uses combined mask: (flags & 13) === 12 means COMPUTING + EFFECT set, DIRTY not set
        if ((flags & (Flag.COMPUTING | Flag.EFFECT | Flag.DIRTY)) === (Flag.COMPUTING | Flag.EFFECT)) {
            node.$_flags = flags | Flag.DIRTY;
            batchedAdd(node);
            scheduleFlush();
        }
        return;
    }
    // Not skipped: set CHECK and propagate to dependents
    node.$_flags = flags | Flag.CHECK;
    if ((flags & Flag.EFFECT) !== 0) {
        batchedAdd(node);
        scheduleFlush();
    }
    const deps = node.$_deps;
    if (deps) {
        for (const dep of deps) {
            markNeedsCheck(dep);
        }
    }
};

/**
 * Mark all dependents in a Set as needing check
 * PUSH PHASE: Entry point for push propagation when a source value changes
 */
export const markDependents = (deps: DepsSet<ReactiveNode>): void => {
    ++globalVersion;
    // Increment deps version for non-live computed polling
    (deps as DepsSet<ReactiveNode>).$_version = ((deps as DepsSet<ReactiveNode>).$_version || 0) + 1;
    for (const dep of deps) {
        markNeedsCheck(dep);
    }
};

/**
 * Run a getter function with dependency tracking
 * Handles cycle detection, context setup, and source cleanup
 * PULL PHASE: Core of pull - executes computation while tracking dependencies
 */
export const runWithTracking = <T>(node: ReactiveNode, getter: () => T): T => {
    // Clear (DIRTY | CHECK) and HAS_STATE_SOURCE (will be recalculated during tracking)
    // Note: Even when called from checkComputedSources (which sets tracked=false), this works
    // because runWithTracking sets tracked=true, so trackDependency will re-set the flag
    node.$_flags = (node.$_flags & ~(Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) | Flag.COMPUTING;
    node.$_skipped = 0;

    const prev = currentComputing;
    const prevTracked = tracked;
    currentComputing = node;
    tracked = true;

    try {
        return getter();
    } finally {
        currentComputing = prev;
        tracked = prevTracked;
        node.$_flags &= ~Flag.COMPUTING;
        const sourcesArray = node.$_sources;
        const skipped = node.$_skipped;
        const updateLen = Math.min(skipped, sourcesArray.length);
        for (let i = 0; i < updateLen; ++i) {
            const entry = sourcesArray[i] as SourceEntry;
            if (entry.$_node) {
                entry.$_version = entry.$_node.$_version;
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
 */
export const untracked = <T>(callback: () => T): T => {
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
 *
 * Note: Callers must check HAS_STATE_SOURCE flag before calling this function.
 * This function assumes all sources are computed (have $_node).
 *
 * @param sourcesArray - The sources to check (must all be computed sources)
 * @returns true if sources changed, false if unchanged
 */
export const checkComputedSources = (sourcesArray: SourceEntry[]): boolean => {
    const prevTracked = tracked;
    tracked = false;
    const len = sourcesArray.length;
    for (let i = 0; i < len; ++i) {
        const sourceEntry = sourcesArray[i] as SourceEntry;
        const sourceNode = sourceEntry.$_node as ReactiveNode;
        // Access source to trigger its recomputation if needed
        try {
            computedRead(sourceNode);
        } catch {
            // Error counts as changed - caller will recompute and may handle differently
            tracked = prevTracked;
            return true;
        }
        // Check if source version changed (meaning its value changed)
        // Early exit - runWithTracking will update all versions during recomputation
        if ((sourceEntry as ComputedSourceEntry).$_version !== sourceNode.$_version) {
            tracked = prevTracked;
            return true;
        }
    }
    tracked = prevTracked;
    return false;
};
