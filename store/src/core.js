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
import { currentComputing, flushScheduled, incrementGlobalVersion, scheduler, setFlushScheduled } from './globals.js';
import { deps, depsTail, flagsSymbol, subs, subsTail, unwrap } from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */

/**
 * Link structure - participates in TWO doubly-linked lists:
 * 1. The subscriber's "deps" list (what it depends on)
 * 2. The dependency's "subs" list (who depends on it)
 *
 * @typedef {Object} Link
 * @property {number} v - Version for staleness checking
 * @property {Computed<any> | SignalNode} dep - The dependency (source being read)
 * @property {Computed<any>} sub - The subscriber (node doing the reading)
 * @property {Link | undefined} prevDep - Previous link in deps list
 * @property {Link | undefined} nextDep - Next link in deps list
 * @property {Link | undefined} prevSub - Previous link in subs list (only used when live)
 * @property {Link | undefined} nextSub - Next link in subs list (only used when live)
 */

/**
 * Signal node structure for linked list tracking
 * @typedef {{ [key: symbol]: Link | undefined }} SignalNode
 */

/** @type {Set<Computed<any>>} */
export let batched = new Set();

/**
 * Unwraps a proxied value to get the underlying object
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const unwrapValue = value => (value != null && /** @type {Record<symbol, any>} */ (/** @type {unknown} */ (value))[unwrap]) || value;

/**
 * Add a link to the subs list of a dependency
 * This creates the "reverse" reference from source to subscriber
 *
 * @param {Link} link - The link to add to the subs list
 */
const addToSubs = link => {
    const dep = link.dep;
    const prevSubLink = dep[subsTail];

    link.prevSub = prevSubLink;
    link.nextSub = undefined;

    if (prevSubLink !== undefined) {
        prevSubLink.nextSub = link;
    } else {
        dep[subs] = link;
    }
    dep[subsTail] = link;
};

/**
 * Remove a link from the subs list of a dependency
 *
 * @param {Link} link - The link to remove from the subs list
 */
const removeFromSubs = link => {
    const dep = link.dep;
    const prevSub = link.prevSub;
    const nextSub = link.nextSub;

    if (nextSub !== undefined) {
        nextSub.prevSub = prevSub;
    } else {
        dep[subsTail] = prevSub;
    }

    if (prevSub !== undefined) {
        prevSub.nextSub = nextSub;
    } else {
        dep[subs] = nextSub;
    }

    link.prevSub = undefined;
    link.nextSub = undefined;
};

/**
 * Create or reuse a link between a dependency and subscriber.
 * The link is always inserted into the sub's deps list.
 * It is only added to the dep's subs list if the subscriber is live.
 *
 * @param {Computed<any> | SignalNode} dep - The dependency being read
 * @param {Computed<any>} sub - The subscriber doing the reading
 * @param {number} version - Version number for staleness tracking
 */
export const link = (dep, sub, version) => {
    const prevDepLink = sub[depsTail];

    // Fast path: if we just linked this same dep, skip
    if (prevDepLink !== undefined && prevDepLink.dep === dep) {
        return;
    }

    // Check if next link in deps list is the same dep (reuse existing link)
    const nextDepLink = prevDepLink !== undefined ? prevDepLink.nextDep : sub[deps];
    if (nextDepLink !== undefined && nextDepLink.dep === dep) {
        nextDepLink.v = version;
        sub[depsTail] = nextDepLink;
        return;
    }

    // Create new link
    /** @type {Link} */
    const newLink = {
        v: version,
        dep,
        sub,
        prevDep: prevDepLink,
        nextDep: nextDepLink,
        prevSub: undefined,
        nextSub: undefined,
    };

    // Update depsTail for subscriber
    sub[depsTail] = newLink;

    // Insert into deps list
    if (nextDepLink !== undefined) {
        nextDepLink.prevDep = newLink;
    }
    if (prevDepLink !== undefined) {
        prevDepLink.nextDep = newLink;
    } else {
        sub[deps] = newLink;
    }

    // Only add to subs list if subscriber is live
    if (sub[flagsSymbol] & FLAG_IS_LIVE) {
        addToSubs(newLink);
    }
};

/**
 * Remove a link from the deps list and optionally from the subs list
 *
 * @param {Link} linkToRemove - The link to remove
 * @param {Computed<any>} sub - The subscriber
 * @param {boolean} isLive - Whether the subscriber is/was live
 * @returns {Link | undefined} - The next link in deps list (for iteration)
 */
export const unlink = (linkToRemove, sub, isLive) => {
    const prevDep = linkToRemove.prevDep;
    const nextDep = linkToRemove.nextDep;

    // Remove from deps list
    if (nextDep !== undefined) {
        nextDep.prevDep = prevDep;
    } else {
        sub[depsTail] = prevDep;
    }
    if (prevDep !== undefined) {
        prevDep.nextDep = nextDep;
    } else {
        sub[deps] = nextDep;
    }

    // Remove from subs list if was live
    if (isLive) {
        const dep = linkToRemove.dep;
        removeFromSubs(linkToRemove);

        // Check if dep became unwatched and should become non-live
        if (dep[subs] === undefined && dep[flagsSymbol] !== undefined) {
            const depFlags = dep[flagsSymbol];
            if (depFlags & FLAG_LIVE && !(depFlags & FLAG_EFFECT)) {
                makeNonLive(/** @type {Computed<any>} */ (dep));
            }
        }
    }

    return nextDep;
};

/**
 * Make a computed live - add all its dep links to their subs lists
 * Called when a live consumer starts reading this computed
 * @param {Computed<any>} node
 */
export const makeLive = node => {
    node[flagsSymbol] |= FLAG_LIVE;
    let linkIter = node[deps];
    while (linkIter !== undefined) {
        // Add this link to the dep's subs list
        addToSubs(linkIter);

        // If dep is a computed that's not live, make it live recursively
        const dep = linkIter.dep;
        if (dep[flagsSymbol] !== undefined && !(dep[flagsSymbol] & FLAG_IS_LIVE)) {
            makeLive(/** @type {Computed<any>} */ (dep));
        }
        linkIter = linkIter.nextDep;
    }
};

/**
 * Make a computed non-live - remove all its dep links from their subs lists
 * Called when all live consumers stop depending on this computed
 * @param {Computed<any>} node
 */
export const makeNonLive = node => {
    node[flagsSymbol] &= ~FLAG_LIVE;
    let linkIter = node[deps];
    while (linkIter !== undefined) {
        const dep = linkIter.dep;
        // Remove from subs list
        removeFromSubs(linkIter);

        // If dep is a live computed (not effect) with no more subs, make it non-live
        const depFlags = dep[flagsSymbol];
        if (depFlags !== undefined && depFlags & FLAG_LIVE && !(depFlags & FLAG_EFFECT)) {
            if (dep[subs] === undefined) {
                makeNonLive(/** @type {Computed<any>} */ (dep));
            }
        }
        linkIter = linkIter.nextDep;
    }
};

/**
 * Clear sources for a node - removes all links after depsTail
 * This is called after recomputation to clean up stale dependencies
 * @param {Computed<any>} node
 */
export const clearSources = node => {
    const tail = node[depsTail];
    const isLive = !!(node[flagsSymbol] & FLAG_IS_LIVE);
    let linkToClear = tail !== undefined ? tail.nextDep : node[deps];
    while (linkToClear !== undefined) {
        linkToClear = unlink(linkToClear, node, isLive);
    }
};

/**
 * Clear ALL sources for a node - removes all links
 * This is called when disposing an effect or fully cleaning up a node
 * @param {Computed<any>} node
 */
export const clearAllSources = node => {
    const isLive = !!(node[flagsSymbol] & FLAG_IS_LIVE);
    node[depsTail] = undefined;
    let linkToClear = node[deps];
    while (linkToClear !== undefined) {
        linkToClear = unlink(linkToClear, node, isLive);
    }
};

/**
 * Execute all pending effects immediately
 * This function can be called to manually trigger all scheduled effects
 * before the next microtask
 */
export const flushEffects = () => {
    setFlushScheduled(false);
    // Swap the batched set to avoid array spread allocation
    const nodes = batched;
    batched = new Set();
    for (const node of nodes) {
        // Access node to trigger recomputation for effects
        // This will also clear the dirty flag
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
 * Track a dependency between currentComputing and a source node
 * Uses liveness tracking - only live consumers register with sources
 * @param {Computed<any> | SignalNode} sourceNode - The source node being accessed
 * @param {number} [version=0] - Version for the link (default 0)
 */
export const trackDependency = (sourceNode, version = 0) => {
    // Callers guarantee tracked && currentComputing are true
    const node = /** @type {Computed<any>} */ (currentComputing);

    // Create the link between source and subscriber
    link(sourceNode, node, version);

    // If we're live, ensure source is also live (for computed sources)
    if (node[flagsSymbol] & FLAG_IS_LIVE) {
        const sourceFlags = sourceNode[flagsSymbol];
        if (sourceFlags !== undefined && !(sourceFlags & FLAG_IS_LIVE)) {
            makeLive(/** @type {Computed<any>} */ (sourceNode));
        }
    }
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * @param {Computed<any>} node
 */
export const markNeedsCheck = node => {
    const flags = node[flagsSymbol];
    if ((flags & FLAG_COMPUTING_EFFECT) === FLAG_COMPUTING_EFFECT) {
        node[flagsSymbol] = flags | FLAG_DIRTY;
        batched.add(node);
        scheduleFlush();
    } else if (!(flags & (FLAG_COMPUTING | FLAG_NEEDS_WORK))) {
        node[flagsSymbol] = flags | FLAG_CHECK;
        if (flags & FLAG_EFFECT) {
            batched.add(node);
            scheduleFlush();
        }
        // Iterate through subs linked list
        let linkIter = node[subs];
        while (linkIter !== undefined) {
            markNeedsCheck(linkIter.sub);
            linkIter = linkIter.nextSub;
        }
    }
};

/**
 * Mark all dependents of a node as needing check
 * @param {Computed<any> | SignalNode} node - The node whose dependents should be notified
 */
export const markDependents = node => {
    incrementGlobalVersion();
    let linkIter = node[subs];
    while (linkIter !== undefined) {
        markNeedsCheck(linkIter.sub);
        linkIter = linkIter.nextSub;
    }
};
