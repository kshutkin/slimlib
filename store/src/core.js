import { append, List, remove } from '@slimlib/list';

import { currentComputing } from './globals.js';
import {
    FLAG_CHECK,
    FLAG_COMPUTING,
    FLAG_COMPUTING_EFFECT,
    FLAG_DIRTY,
    FLAG_EFFECT,
    FLAG_IS_LIVE,
    FLAG_LIVE,
    FLAG_NEEDS_WORK,
} from './flags.js';
import { flushScheduled, incrementGlobalVersion, scheduler, setFlushScheduled } from './globals.js';
import { dependencies, flagsSymbol, skippedDeps, sources, unwrap } from './symbols.js';

/**
 * @typedef {import('@slimlib/list').ListNode} ListNode
 */

/**
 * A computed value that can be part of the batched list
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any, n?: ListNode, p?: ListNode, i?: number }} Computed
 */

/** @type {List<Computed<any>>} */
export let batched = new List;

/** @type {number} */
let lastAddedId = -1;

/** @type {boolean} */
let needsSort = false;

/**
 * Add an effect to the batched list (if not already in it)
 * @param {Computed<any>} node
 */
const batchedAdd = node => {
    if (/** @type {{n: ListNode | undefined}} */ (node).n === undefined) {
        const nodeId = /** @type {number} */ (node.i);
        // Track if we're adding out of order
        if (nodeId < lastAddedId) {
            needsSort = true;
        }
        lastAddedId = nodeId;
        // O(1) append - sorting happens at flush time only if needed
        append(batched, /** @type {ListNode} */ (node));
    }
};

/**
 * Remove an effect from the batched list
 * @param {Computed<any>} node
 */
export const batchedDelete = node => {
    const listNode = /** @type {{n: ListNode | undefined}} */ (node);
    if (listNode.n !== undefined) {
        remove(/** @type {ListNode} */ (node));
        listNode.n = undefined;
    }
};

/**
 * Unwraps a proxied value to get the underlying object
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const unwrapValue = value => (value != null && /** @type {Record<symbol, any>} */ (/** @type {unknown} */ (value))[unwrap]) || value;

/**
 * Make a computed live - register it with all its sources
 * Called when a live consumer starts reading this computed
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
 * @param {Computed<any>} node
 */
export const makeNonLive = node => {
    node[flagsSymbol] &= ~FLAG_LIVE;
    for (const { d: deps, n: sourceNode } of node[sources]) {
        deps.delete(node);
        const sourceNodeFlag = sourceNode?.[flagsSymbol];
        if (sourceNodeFlag & FLAG_LIVE && !(sourceNodeFlag & FLAG_EFFECT) && !sourceNode[dependencies].size) {
            makeNonLive(sourceNode);
        }
    }
};

/**
 * Clear sources for a node starting from a specific index
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

        if (isLive && !retained) {
            deps.delete(node);
            // If source is a computed, check if it became non-live
            const sourceNodeFlag = sourceNode?.[flagsSymbol];
            if (sourceNodeFlag & FLAG_LIVE && !(sourceNodeFlag & FLAG_EFFECT) && !sourceNode[dependencies].size) {
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
 */
export const flushEffects = () => {
    setFlushScheduled(false);
    // Collect nodes, only sort if effects were added out of order
    const nodes = [...batched];
    if (needsSort) {
        nodes.sort((a, b) => /** @type {number} */ (a.i) - /** @type {number} */ (b.i));
    }
    batched = new List;
    lastAddedId = -1;
    needsSort = false;
    // Clear n property and call effect in one pass
    for (const node of nodes) {
        /** @type {{n: ListNode | undefined}} */ (node).n = undefined;
        node();
    }
};

/**
 * Schedule flush via scheduler (default: microtask)
 */
export const scheduleFlush = () => {
    if (!flushScheduled) {
        setFlushScheduled(true);
        scheduler(flushEffects);
    }
};

/**
 * Track a dependency between currentComputing and a deps Set
 * Uses liveness tracking - only live consumers register with sources
 * @param {Set<Computed<any>>} deps - The dependency set to track
 * @param {Computed<any>} [sourceNode] - The computed node being accessed (if any)
 */
export const trackDependency = (deps, sourceNode) => {
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
        sourcesArray.push({ d: deps, n: sourceNode, v: 0 });

        // Only register with source if we're live
        if (node[flagsSymbol] & FLAG_IS_LIVE) {
            deps.add(node);
            // If source is a computed that's not live, make it live
            if (sourceNode && !(sourceNode[flagsSymbol] & FLAG_IS_LIVE)) {
                makeLive(sourceNode);
            }
        }
    }
    ++node[skippedDeps];
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * @param {Computed<any>} node
 */
export const markNeedsCheck = node => {
    const flags = node[flagsSymbol];
    if ((flags & FLAG_COMPUTING_EFFECT) === FLAG_COMPUTING_EFFECT) {
        node[flagsSymbol] = flags | FLAG_DIRTY;
        batchedAdd(node);
        scheduleFlush();
    } else if (!(flags & (FLAG_COMPUTING | FLAG_NEEDS_WORK))) {
        node[flagsSymbol] = flags | FLAG_CHECK;
        if (flags & FLAG_EFFECT) {
            batchedAdd(node);
            scheduleFlush();
        }
        for (const dep of node[dependencies]) {
            markNeedsCheck(dep);
        }
    }
};

/**
 * Mark all dependents in a Set as needing check
 * @param {Set<Computed<any>>} deps - The dependency set to notify
 */
export const markDependents = deps => {
    incrementGlobalVersion();
    for (const dep of deps) {
        markNeedsCheck(dep);
    }
};
