/**
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
 *   - Lazily recompute by pulling values from sources
 *   - Update cached value and version
 */

import { computedRead } from './computed';
import { Flag } from './flags';
import { scheduler } from './globals';
import { unwrap } from './symbols';
import type { EffectNode, Link, ReactiveNode, Subscribable } from './internal-types';
import { safeForEach } from './debug';

let flushScheduled = false;

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 1;

export const batched: EffectNode[] = [];

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
export const batchedAdd = (node: EffectNode): void => {
    const nodeId = node.$_id;
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
export const batchedAddNew = (node: EffectNode, effectId: number): void => {
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
    }
};

/**
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
        nodes.sort((a, b) => a.$_id - b.$_id);
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
 * Track a state/signal dependency between currentComputing and a Subscribable.
 * PULL PHASE: Records dependencies during computation for future invalidation.
 */
export const trackStateDependency = <T>(
    deps: Subscribable,
    valueGetter: () => T,
    cachedValue: T
): void => {
    // Callers guarantee tracked && currentComputing are true
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
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * PUSH PHASE: Eagerly propagates CHECK flag up the dependency graph
 */
export const markNeedsCheck = (node: ReactiveNode): void => {
    // Iterative propagation using an explicit stack to avoid
    // call stack overhead and stack overflow on deep dependency chains
    let stack: ReactiveNode[] | undefined;
    let current: ReactiveNode | undefined = node;

    do {
        const flags = current.$_flags;
        // Fast path: skip if already computing, dirty, or marked CHECK
        if ((flags & (Flag.COMPUTING | Flag.DIRTY | Flag.CHECK)) !== 0) {
            // Exception: computing effect that's not dirty yet needs to be marked dirty
            if ((flags & (Flag.COMPUTING | Flag.EFFECT | Flag.DIRTY)) === (Flag.COMPUTING | Flag.EFFECT)) {
                current.$_flags = flags | Flag.DIRTY;
                batchedAdd(current as EffectNode);
                scheduleFlush();
            }
            // Pop next from stack
            current = stack !== undefined ? stack.pop() : undefined;
            continue;
        }
        // Not skipped: set CHECK and propagate to dependents
        current.$_flags = flags | Flag.CHECK;
        if ((flags & Flag.EFFECT) !== 0) {
            batchedAdd(current as EffectNode);
            scheduleFlush();
        }

        // Propagate to all subscribers via subs linked list
        // First subscriber becomes next current (tail-call style), siblings go on stack
        let link = current.$_subs;
        if (link !== undefined) {
            current = link.$_sub;
            link = link.$_nextSub;
            while (link !== undefined) {
                if (stack === undefined) {
                    stack = [];
                }
                stack.push(link.$_sub);
                link = link.$_nextSub;
            }
        } else {
            current = stack !== undefined ? stack.pop() : undefined;
        }
    } while (current !== undefined);
};

/**
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
    }
};

/**
 * Run a getter function with dependency tracking.
 * Handles cycle detection, context setup, and source cleanup.
 * PULL PHASE: Core of pull - executes computation while tracking dependencies.
 */
export const runWithTracking = <T>(node: ReactiveNode, getter: () => T): T => {
    // Clear (DIRTY | CHECK) and HAS_STATE_SOURCE (will be recalculated during tracking)
    node.$_flags = (node.$_flags & ~(Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) | Flag.COMPUTING;

    // Reset tail to walk through existing links
    node.$_depsTail = undefined;

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
 * @param node - The node whose sources to check
 * @returns true if sources changed, false if unchanged
 */
export const checkComputedSources = (node: ReactiveNode): boolean => {
    const prevTracked = tracked;
    tracked = false;
    try {
        let link = node.$_deps;
        while (link !== undefined) {
            // All deps here are computed sources (HAS_STATE_SOURCE check ensures this)
            const dep = link.$_dep as ReactiveNode;

            // Access source to trigger its recomputation if needed
            try {
                computedRead(dep);
            } catch {
                // Error counts as changed - caller will recompute and may handle differently
                return true;
            }
            // Check if source version changed (meaning its value changed)
            if (link.$_version !== dep.$_version) {
                return true;
            }
            link = link.$_nextDep;
        }
        return false;
    } finally {
        tracked = prevTracked;
    }
};