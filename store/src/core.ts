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
import { safeForEach } from './debug';
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
} from './flags';
import { scheduler } from './globals';
import { dependencies, depsVersionSymbol, flagsSymbol, skippedDeps, sources, unwrap, versionSymbol } from './symbols';
import type { Computed, SourceEntry } from './types';

export { depsVersionSymbol };

let flushScheduled = false;

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 0;

export let batched: Set<Computed<any>> = new Set();

let lastAddedId = 0;

let needsSort = false;

// Computation tracking state
export let currentComputing: Computed<any> | null = null;
export let tracked = true;

/**
 * Add an effect to the batched set
 * PUSH PHASE: Part of effect scheduling during dirty propagation
 * Caller must check FLAG_NEEDS_WORK before calling to avoid duplicates
 */
export const batchedAdd = (node: Computed<any>): void => {
    const nodeId = node.i as number;
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
 */
export const batchedAddNew = (node: Computed<any>, effectId: number): void => {
    lastAddedId = effectId;
    batched.add(node);
};

/**
 * Unwraps a proxied value to get the underlying object
 * (Utility - not specific to push/pull phases)
 */
export const unwrapValue = <T>(value: T): T => (value != null && (value as unknown as Record<symbol, any>)[unwrap]) || value;

/**
 * Make a computed live - register it with all its sources
 * Called when a live consumer starts reading this computed
 * PUSH PHASE: Enables push notifications to flow through this node
 */
export const makeLive = (node: Computed<any>): void => {
    node[flagsSymbol] |= FLAG_LIVE;
    for (const { d: deps, n: sourceNode } of node[sources] as SourceEntry[]) {
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
 */
export const makeNonLive = (node: Computed<any>): void => {
    node[flagsSymbol] &= ~FLAG_LIVE;
    for (const { d: deps, n: sourceNode } of node[sources] as SourceEntry[]) {
        deps.delete(node);
        const sourceNodeFlag = sourceNode?.[flagsSymbol];
        // Check: has FLAG_LIVE but not FLAG_EFFECT (effects never become non-live)
        if ((sourceNodeFlag & FLAG_IS_LIVE) === FLAG_LIVE && !(sourceNode as Computed<any>)[dependencies].size) {
            makeNonLive(sourceNode as Computed<any>);
        }
    }
};

/**
 * Clear sources for a node starting from a specific index
 * PULL PHASE: Cleanup during dependency tracking when sources change
 */
export const clearSources = (node: Computed<any>, fromIndex = 0): void => {
    const sourcesArray = node[sources] as SourceEntry[];
    const isLive = node[flagsSymbol] & FLAG_IS_LIVE;

    for (let i = fromIndex; i < sourcesArray.length; i++) {
        const { d: deps, n: sourceNode } = sourcesArray[i]!;

        // Check if this deps is retained (exists in kept portion) - avoid removing shared deps
        let retained = false;
        for (let j = 0; j < fromIndex && !retained; j++) {
            retained = sourcesArray[j]!.d === deps;
        }

        if (!retained) {
            // Always remove from deps to prevent stale notifications
            deps.delete(node);
            // If source is a computed and we're live, check if it became non-live
            if (isLive) {
                const sourceNodeFlag = sourceNode?.[flagsSymbol];
                // Check: has FLAG_LIVE but not FLAG_EFFECT (effects never become non-live)
                if ((sourceNodeFlag & FLAG_IS_LIVE) === FLAG_LIVE && !(sourceNode as Computed<any>)[dependencies].size) {
                    makeNonLive(sourceNode as Computed<any>);
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
export const flushEffects = (): void => {
    flushScheduled = false;
    // Collect nodes, only sort if effects were added out of order
    const nodes: Computed<any>[] = [...batched];
    if (needsSort) {
        nodes.sort((a, b) => (a.i as number) - (b.i as number));
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
export const trackStateDependency = (deps: Set<Computed<any>>, valueGetter: () => any): void => {
    // Callers guarantee tracked && currentComputing are true
    const node = currentComputing as Computed<any>;
    const sourcesArray = node[sources] as SourceEntry[];
    const skipIndex = node[skippedDeps] as number;

    if (sourcesArray[skipIndex]?.d !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(node, skipIndex);
        }

        // Track deps version, value getter, and last seen value for polling
        const currentValue = valueGetter();
        sourcesArray.push({
            d: deps,
            n: undefined,
            v: 0,
            dv: (deps as any)[depsVersionSymbol] || 0,
            g: valueGetter,
            sv: currentValue,
        });

        // Mark that this node has state/signal sources (for polling optimization)
        node[flagsSymbol] |= FLAG_HAS_STATE_SOURCE;

        // Only register with source if we're live
        if (node[flagsSymbol] & FLAG_IS_LIVE) {
            deps.add(node);
        }
    } else {
        // Same state source - update dv, g, and sv for accurate polling
        const entry = sourcesArray[skipIndex];
        entry.dv = (deps as any)[depsVersionSymbol] || 0;
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
 */
export const markNeedsCheck = (node: Computed<any>): void => {
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
        const deps = node[dependencies] as Set<Computed<any>> | undefined;
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
 */
export const markDependents = (deps: Set<Computed<any>>): void => {
    ++globalVersion;
    // Increment deps version for non-live computed polling
    (deps as any)[depsVersionSymbol] = ((deps as any)[depsVersionSymbol] || 0) + 1;
    for (const dep of deps) {
        markNeedsCheck(dep);
    }
};

/**
 * Run a getter function with dependency tracking
 * Handles cycle detection, context setup, and source cleanup
 * PULL PHASE: Core of pull - executes computation while tracking dependencies
 */
export const runWithTracking = <T>(node: Computed<any>, getter: () => T): T => {
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
        const sourcesArray = node[sources] as SourceEntry[];
        const skipped = node[skippedDeps] as number;
        const updateLen = Math.min(skipped, sourcesArray.length);
        for (let i = 0; i < updateLen; i++) {
            const entry = sourcesArray[i]!;
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
 */
export const checkComputedSources = (sourcesArray: SourceEntry[], skipStateCheck = false): boolean | null => {
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
            computedRead.call(sourceNode as Computed<any>);
        } catch {
            // Error counts as changed - caller will recompute and may handle differently
            tracked = prevTracked;
            return true;
        }
        // Check if source version changed (meaning its value changed)
        if (sourceEntry.v !== (sourceNode as Computed<any>)[versionSymbol]) {
            changed = true;
            sourceEntry.v = (sourceNode as Computed<any>)[versionSymbol];
        }
    }
    tracked = prevTracked;
    return changed;
};
