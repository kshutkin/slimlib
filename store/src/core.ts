/**
<<<<<<< Updated upstream
 * Core reactive system implementation using push/pull algorithm:
 *
 * PUSH PHASE: When a source value changes (signal/state write):
 *   - Increment globalVersion
 *   - Eagerly propagate CHECK flags to all dependents
 *   - Schedule effects for execution
 *
 * PULL PHASE: When a computed/effect is read:
 *   - Check if recomputation is needed (via flags and source versions)
=======
 * Core reactive system implementation using push/pull algorithm with Link-based dependency tracking.
 *
 * Inspired by alien-signals, this implementation uses a Link object that participates
 * in two doubly-linked lists simultaneously:
 * 1. As an entry in the subscriber's "deps" list (sources it depends on)
 * 2. As an entry in the dependency's "subs" list (subscribers that depend on it)
 *
 * PUSH PHASE: When a source value changes (signal/state write):
 *   - Increment globalVersion
 *   - Eagerly propagate CHECK flags to all dependents via subs list
 *   - Schedule effects for execution
 *
 * PULL PHASE: When a computed/effect is read:
 *   - Check if recomputation is needed (via flags and link versions)
>>>>>>> Stashed changes
 *   - Lazily recompute by pulling values from sources
 *   - Update cached value and version
 */

import { computedRead } from './computed';
import { Flag } from './flags';
import { scheduler } from './globals';
import { unwrap } from './symbols';
<<<<<<< Updated upstream
import type { ComputedSourceEntry, DepsSet, InternalEffect, ReactiveNode, SourceEntry, StateSourceEntry } from './internal-types';
=======
import type { EffectNode, Link, ReactiveNode, Subscribable } from './internal-types';
>>>>>>> Stashed changes
import { safeForEach } from './debug';

let flushScheduled = false;

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 1;

<<<<<<< Updated upstream
export const batched: InternalEffect[] = [];
=======
export const batched: EffectNode[] = [];
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
export const batchedAdd = (node: ReactiveNode): void => {
    const nodeId = node.$_id as number;
=======
export const batchedAdd = (node: EffectNode): void => {
    const nodeId = node.$_id;
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
export const batchedAddNew = (node: InternalEffect, effectId: number): void => {
=======
export const batchedAddNew = (node: EffectNode, effectId: number): void => {
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
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
=======
 * Link a dependency to a subscriber.
 * Creates a new Link or reuses an existing one if possible.
 * The Link participates in the sub's deps list, and optionally in the dep's subs list (for live subscribers).
 *
 * PULL PHASE: Called during dependency tracking when a computed/effect reads a source.
 *
 * @param dep - The dependency (source) being subscribed to
 * @param sub - The subscriber (computed/effect)
 * @param version - Current version for tracking changes
 * @param getter - Optional getter for state sources (polling)
 * @param storedValue - Optional stored value for state sources (polling)
 * @param registerWithSource - Whether to register in dep's subs list (false for non-live)
 */
export const link = (dep: Subscribable, sub: ReactiveNode, version: number, getter?: () => unknown, storedValue?: unknown, registerWithSource = true): void => {
    const prevDep = sub.$_depsTail;

    // Fast path: same dependency as last time (dedupe consecutive reads)
    if (prevDep !== undefined && prevDep.$_dep === dep) {
        // Update polling metadata for state sources
        if (getter !== undefined) {
            prevDep.$_getter = getter;
            prevDep.$_storedValue = storedValue;
        }
        return;
    }

    // Check if next link in deps list is the same dep (reuse case)
    const nextDep = prevDep !== undefined ? prevDep.$_nextDep : sub.$_deps;
    if (nextDep !== undefined && nextDep.$_dep === dep) {
        nextDep.$_version = version;
        // Update polling metadata for state sources
        if (getter !== undefined) {
            nextDep.$_getter = getter;
            nextDep.$_storedValue = storedValue;
            sub.$_flags |= Flag.HAS_STATE_SOURCE;
        }
        sub.$_depsTail = nextDep;
        return;
    }

    // Get the tail of subs list for insertion
    const prevSub = registerWithSource ? dep.$_subsTail : undefined;

    // Create new link
    const newLink: Link = {
        $_version: version,
        $_dep: dep,
        $_sub: sub,
        $_prevDep: prevDep,
        $_nextDep: nextDep,
        $_prevSub: prevSub,
        $_nextSub: undefined,
        $_getter: getter,
        $_storedValue: storedValue,
    };

    // Insert into subscriber's deps list
    sub.$_depsTail = newLink;
    if (nextDep !== undefined) {
        nextDep.$_prevDep = newLink;
    }
    if (prevDep !== undefined) {
        prevDep.$_nextDep = newLink;
    } else {
        sub.$_deps = newLink;
    }

    // Insert into dependency's subs list (only for live subscribers)
    if (registerWithSource) {
        dep.$_subsTail = newLink;
        if (prevSub !== undefined) {
            prevSub.$_nextSub = newLink;
        } else {
            dep.$_subs = newLink;
        }
    }

    // Mark if this is a state source (has getter)
    if (getter !== undefined) {
        sub.$_flags |= Flag.HAS_STATE_SOURCE;
>>>>>>> Stashed changes
    }
};

/**
<<<<<<< Updated upstream
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
        if (sourceNode && (sourceNode.$_flags & (Flag.EFFECT | Flag.LIVE)) === Flag.LIVE && (sourceNode.$_deps as Set<ReactiveNode>).size === 0) {
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
            if (isLive && sourceNode && (sourceNode.$_flags & (Flag.EFFECT | Flag.LIVE)) === Flag.LIVE && (sourceNode.$_deps as Set<ReactiveNode>).size === 0) {
                makeNonLive(sourceNode);
            }
        }
    }
    sourcesArray.length = fromIndex;
=======
 * Unlink a Link from both the deps and subs lists.
 * Returns the next link in the deps list for iteration.
 *
 * PULL PHASE: Called during source cleanup when dependencies change.
 */
export const unlink = (linkToRemove: Link, sub: ReactiveNode = linkToRemove.$_sub): Link | undefined => {
    const dep = linkToRemove.$_dep;
    const prevDep = linkToRemove.$_prevDep;
    const nextDep = linkToRemove.$_nextDep;
    const nextSub = linkToRemove.$_nextSub;
    const prevSub = linkToRemove.$_prevSub;

    // Remove from subscriber's deps list
    if (nextDep !== undefined) {
        nextDep.$_prevDep = prevDep;
    } else {
        sub.$_depsTail = prevDep;
    }
    if (prevDep !== undefined) {
        prevDep.$_nextDep = nextDep;
    } else {
        sub.$_deps = nextDep;
    }

    // Remove from dependency's subs list (only if it was registered)
    // Links from non-live subscribers may not be in the subs list
    const wasInSubsList = prevSub !== undefined || dep.$_subs === linkToRemove;
    if (wasInSubsList) {
        if (nextSub !== undefined) {
            nextSub.$_prevSub = prevSub;
        } else {
            dep.$_subsTail = prevSub;
        }
        if (prevSub !== undefined) {
            prevSub.$_nextSub = nextSub;
        } else {
            dep.$_subs = nextSub;
            // If no more subscribers and dep is a reactive node, it became non-live
            if (nextSub === undefined && isReactiveNode(dep)) {
                unwatched(dep);
            }
        }
    }

    return nextDep;
};

/**
 * Check if a Subscribable is a full ReactiveNode
 */
const isReactiveNode = (node: Subscribable): node is ReactiveNode => {
    return '$_flags' in node;
};

/**
 * Called when a computed node has no more subscribers.
 * Makes the node non-live and cleans up its dependencies.
 *
 * PUSH PHASE: Disables push notifications through this node.
 * 
 * Note: This is only called on live computed nodes (via unlink when subs becomes empty).
 * Effects are never passed here since they don't have subscribers.
 */
const unwatched = (node: ReactiveNode): void => {
    // Clear LIVE flag
    node.$_flags &= ~Flag.LIVE;

    // Unlink all dependencies
    let link = node.$_deps;
    while (link !== undefined) {
        link = unlink(link, node);
    }
    node.$_deps = undefined;
    node.$_depsTail = undefined;

    // Mark as dirty so it will be recomputed when read again
    node.$_flags |= Flag.DIRTY;
};

/**
 * Make a computed live - called when a live consumer starts reading this computed.
 * PUSH PHASE: Enables push notifications to flow through this node.
 */
export const makeLive = (node: ReactiveNode): void => {
    node.$_flags |= Flag.LIVE;

    // Traverse deps list and register with each source's subs list
    let linkNode = node.$_deps;
    while (linkNode !== undefined) {
        const dep = linkNode.$_dep;

        // Register this link in the dependency's subs list
        // Links were created without subs registration when non-live, so $_prevSub is always undefined
        const prevSub = dep.$_subsTail;
        linkNode.$_prevSub = prevSub;
        dep.$_subsTail = linkNode;
        if (prevSub !== undefined) {
            prevSub.$_nextSub = linkNode;
        } else {
            dep.$_subs = linkNode;
        }

        // If source is a computed that's not yet live, make it live
        if (isReactiveNode(dep) && (dep.$_flags & (Flag.EFFECT | Flag.LIVE)) === 0) {
            makeLive(dep);
        }
        linkNode = linkNode.$_nextDep;
    }
};

/**
 * Clear sources for a node starting from a specific link
 * PULL PHASE: Cleanup during dependency tracking when sources change
 */
export const clearSources = (node: ReactiveNode, fromLink: Link | undefined = node.$_deps): void => {
    let link = fromLink;
    while (link !== undefined) {
        link = unlink(link, node);
    }
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
        nodes.sort((a, b) => (a.$_id as number) - (b.$_id as number));
=======
        nodes.sort((a, b) => a.$_id - b.$_id);
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
 * Track a state/signal dependency between currentComputing and a deps Set
 * Uses liveness tracking - only live consumers register with sources
 * PULL PHASE: Records dependencies during computation for future invalidation
 */
export const trackStateDependency = <T>(
    deps: DepsSet<ReactiveNode>,
=======
 * Track a state/signal dependency between currentComputing and a Subscribable.
 * PULL PHASE: Records dependencies during computation for future invalidation.
 */
export const trackStateDependency = <T>(
    deps: Subscribable,
>>>>>>> Stashed changes
    valueGetter: () => T,
    cachedValue: T
): void => {
    // Callers guarantee tracked && currentComputing are true
<<<<<<< Updated upstream

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
=======
    const sub = currentComputing as ReactiveNode;
    const isLive = (sub.$_flags & (Flag.EFFECT | Flag.LIVE)) !== 0;

    // For live subscribers, register in source's subs list for push notifications
    // For non-live, only track in deps list for polling
    link(deps, sub, deps.$_version, valueGetter, cachedValue, isLive);
};

/**
 * Track a computed dependency between currentComputing and a computed node.
 * PULL PHASE: Records dependencies during computation for future invalidation.
 */
export const trackComputedDependency = (source: ReactiveNode): void => {
    // Callers guarantee tracked && currentComputing are true
    const sub = currentComputing as ReactiveNode;
    const isLive = (sub.$_flags & (Flag.EFFECT | Flag.LIVE)) !== 0;

    // For live subscribers, register in source's subs list for push notifications
    // For non-live, only track in deps list for polling
    link(source, sub, source.$_version, undefined, undefined, isLive);

    // If subscriber is live and source computed is not live, make it live
    if (isLive && (source.$_flags & (Flag.EFFECT | Flag.LIVE)) === 0) {
        makeLive(source);
    }
>>>>>>> Stashed changes
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * PUSH PHASE: Eagerly propagates CHECK flag up the dependency graph
 */
export const markNeedsCheck = (node: ReactiveNode): void => {
    const flags = node.$_flags;
    // Fast path: skip if already computing, dirty, or marked CHECK
<<<<<<< Updated upstream
    // (COMPUTING | DIRTY | CHECK) (bits 0, 1, 2)
    if ((flags & (Flag.COMPUTING | Flag.DIRTY | Flag.CHECK)) !== 0) {
        // Exception: computing effect that's not dirty yet needs to be marked dirty
        // Uses combined mask: (flags & 13) === 12 means COMPUTING + EFFECT set, DIRTY not set
        if ((flags & (Flag.COMPUTING | Flag.EFFECT | Flag.DIRTY)) === (Flag.COMPUTING | Flag.EFFECT)) {
            node.$_flags = flags | Flag.DIRTY;
            batchedAdd(node);
=======
    if ((flags & (Flag.COMPUTING | Flag.DIRTY | Flag.CHECK)) !== 0) {
        // Exception: computing effect that's not dirty yet needs to be marked dirty
        if ((flags & (Flag.COMPUTING | Flag.EFFECT | Flag.DIRTY)) === (Flag.COMPUTING | Flag.EFFECT)) {
            node.$_flags = flags | Flag.DIRTY;
            batchedAdd(node as EffectNode);
>>>>>>> Stashed changes
            scheduleFlush();
        }
        return;
    }
    // Not skipped: set CHECK and propagate to dependents
    node.$_flags = flags | Flag.CHECK;
    if ((flags & Flag.EFFECT) !== 0) {
<<<<<<< Updated upstream
        batchedAdd(node);
        scheduleFlush();
    }
    const deps = node.$_deps;
    if (deps) {
        for (const dep of deps) {
            markNeedsCheck(dep);
        }
=======
        batchedAdd(node as EffectNode);
        scheduleFlush();
    }

    // Propagate to all subscribers via subs linked list
    let link = node.$_subs;
    while (link !== undefined) {
        markNeedsCheck(link.$_sub);
        link = link.$_nextSub;
>>>>>>> Stashed changes
    }
};

/**
<<<<<<< Updated upstream
 * Mark all dependents in a Set as needing check
 * PUSH PHASE: Entry point for push propagation when a source value changes
 */
export const markDependents = (deps: DepsSet<ReactiveNode>): void => {
    ++globalVersion;
    // Increment deps version for non-live computed polling
    (deps as DepsSet<ReactiveNode>).$_version = ((deps as DepsSet<ReactiveNode>).$_version || 0) + 1;
    for (const dep of deps) {
        markNeedsCheck(dep);
=======
 * Mark all dependents in a Subscribable as needing check
 * PUSH PHASE: Entry point for push propagation when a source value changes
 */
export const markDependents = (deps: Subscribable): void => {
    ++globalVersion;
    // Increment version for polling
    ++deps.$_version;

    // Propagate to all subscribers via subs linked list
    let link = deps.$_subs;
    while (link !== undefined) {
        markNeedsCheck(link.$_sub);
        link = link.$_nextSub;
>>>>>>> Stashed changes
    }
};

/**
<<<<<<< Updated upstream
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
=======
 * Run a getter function with dependency tracking.
 * Handles cycle detection, context setup, and source cleanup.
 * PULL PHASE: Core of pull - executes computation while tracking dependencies.
 */
export const runWithTracking = <T>(node: ReactiveNode, getter: () => T): T => {
    // Clear (DIRTY | CHECK) and HAS_STATE_SOURCE (will be recalculated during tracking)
    node.$_flags = (node.$_flags & ~(Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) | Flag.COMPUTING;

    // Reset tail to walk through existing links
    node.$_depsTail = undefined;
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
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
=======

        // Update versions for reused links and clean up excess
        // Note: depsTail may have been modified during getter() execution via link()
        const newTail = node.$_depsTail as Link | undefined;
        if (newTail) {
            // Update versions for reused links
            // This is needed for the bail-out optimization: when a computed recomputes
            // but its value doesn't change, downstream computeds should not recompute.
            // The version check in checkComputedSources compares link.version to dep.version.
            // After a source recomputes with unchanged value, its version stays the same,
            // so link.version must match for the bailout to work correctly.
            let currentLink: Link | undefined = node.$_deps;
            while (currentLink) {
                // State sources have getter defined, computed sources don't
                if (currentLink.$_getter === undefined) {
                    currentLink.$_version = (currentLink.$_dep as ReactiveNode).$_version;
                }
                if (currentLink === newTail) break;
                currentLink = currentLink.$_nextDep;
            }

            // Clean up excess links that weren't reused
            const excessLink = (newTail as Link).$_nextDep;
            if (excessLink) {
                clearSources(node, excessLink);
                (newTail as Link).$_nextDep = undefined;
            }
        } else if (node.$_deps) {
            // No dependencies were tracked, clear all
            clearSources(node, node.$_deps);
            node.$_deps = undefined;
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
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
=======
 * @param node - The node whose sources to check
 * @returns true if sources changed, false if unchanged
 */
export const checkComputedSources = (node: ReactiveNode): boolean => {
    const prevTracked = tracked;
    tracked = false;

    let link = node.$_deps;
    while (link !== undefined) {
        // All deps here are computed sources (HAS_STATE_SOURCE check ensures this)
        const dep = link.$_dep as ReactiveNode;

        // Access source to trigger its recomputation if needed
        try {
            computedRead(dep);
>>>>>>> Stashed changes
        } catch {
            // Error counts as changed - caller will recompute and may handle differently
            tracked = prevTracked;
            return true;
        }
        // Check if source version changed (meaning its value changed)
<<<<<<< Updated upstream
        // Early exit - runWithTracking will update all versions during recomputation
        if ((sourceEntry as ComputedSourceEntry).$_version !== sourceNode.$_version) {
            tracked = prevTracked;
            return true;
        }
    }
    tracked = prevTracked;
    return false;
};
=======
        if (link.$_version !== dep.$_version) {
            tracked = prevTracked;
            return true;
        }
        link = link.$_nextDep;
    }
    tracked = prevTracked;
    return false;
};
>>>>>>> Stashed changes
