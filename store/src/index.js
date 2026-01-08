import { DEV } from 'esm-env';

const [
    unwrap,
    sources,
    dependencies,
    flagsSymbol,
    skippedDeps,
    lastGlobalVersionSymbol,
    getterSymbol,
    equalsSymbol,
    valueSymbol,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
    versionSymbol,
] = /** @type {[symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol]}*/ (
    Array.from({ length: 13 }, () => Symbol())
);

/**
 * Debug configuration flag: Warn when writing to signals/state inside a computed
 * @type {number}
 */
export const WARN_ON_WRITE_IN_COMPUTED = 1 << 0;

/**
 * Current debug configuration bitfield
 * @type {number}
 */
let debugConfigFlags = 0;

/**
 * Configure debug behavior using a bitfield of flags
 * @param {number} flags - Bitfield of debug flags (e.g., WARN_ON_WRITE_IN_COMPUTED)
 * @returns {void}
 */
export const debugConfig = flags => {
    debugConfigFlags = flags | 0;
};

/**
 * Cleanup function returned by effect callback
 * @typedef {() => void} EffectCleanup
 */

/**
 * Callback function for onDispose registration
 * @typedef {(cleanup: () => void) => void} OnDisposeCallback
 */

/**
 * Callback function passed to scope
 * @typedef {(onDispose: OnDisposeCallback) => void} ScopeCallback
 */

/**
 * Signal type - a callable that returns the current value with a set method
 * @template T
 * @typedef {(() => T) & { set: (value: T) => void }} Signal
 */

/**
 * Safely call each function in an iterable, logging any errors to console
 * @param {Iterable<() => void>} fns
 */
const safeForEach = fns => {
    for (const fn of fns) {
        try {
            fn();
        } catch (e) {
            console.error(e);
        }
    }
};

/**
 * Warn if writing inside a computed (not an effect)
 * Only runs in DEV mode and when configured
 * @param {string} context - Description of where the write is happening
 */
const warnIfWriteInComputed = context => {
    if (DEV && debugConfigFlags & WARN_ON_WRITE_IN_COMPUTED && currentComputing && !(currentComputing[flagsSymbol] & FLAG_EFFECT)) {
        console.warn(
            `[@slimlib/store] Writing to ${context} inside a computed is not recommended. ` +
                `The computed will not automatically re-run when this value changes, which may lead to stale values.`
        );
    }
};

// Bit flags for node state
const FLAG_DIRTY = 1 << 0; // 1 - definitely needs recomputation
const FLAG_CHECK = 1 << 1; // 2 - might need recomputation, check sources first
const FLAG_COMPUTING = 1 << 2; // 4 - currently executing
const FLAG_EFFECT = 1 << 3; // 8 - is an effect (eager execution, always live)
const FLAG_HAS_VALUE = 1 << 4; // 16 - has a cached value
const FLAG_HAS_ERROR = 1 << 5; // 32 - has a cached error (per TC39 Signals proposal)
const FLAG_LIVE = 1 << 6; // 64 - computed is live (has live dependents)

// Pre-combined flags for faster checks
const FLAG_NEEDS_WORK = FLAG_DIRTY | FLAG_CHECK; // 3 - needs recomputation
const FLAG_COMPUTING_EFFECT = FLAG_COMPUTING | FLAG_EFFECT; // 12 - computing effect
const FLAG_CHECK_ONLY = FLAG_CHECK | FLAG_DIRTY | FLAG_EFFECT; // 11 - for checking if only CHECK is set
const FLAG_IS_LIVE = FLAG_EFFECT | FLAG_LIVE; // 72 - either an effect or live computed

/**
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any }} Computed
 */
// Global state
/** @type {Computed<any> | null} */
let currentComputing = null;
/** @type {Set<Computed<any>>} */
const batched = new Set();
let flushScheduled = false;
let tracked = true;

/**
 * @typedef {ScopeFunction & { [key: symbol]: any }} Scope
 */

/**
 * @typedef {((callback: ScopeCallback) => Scope) & (() => undefined)} ScopeFunction
 */

/**
 * Active scope for effect tracking
 * When set, effects created will be tracked to this scope
 * Can be set via setActiveScope() or automatically during scope() callbacks
 * @type {Scope | undefined}
 */
export let activeScope = undefined;

/**
 * Set the active scope for effect tracking
 * Effects created outside of a scope() callback will be tracked to this scope
 * Pass undefined to clear the active scope
 * @param {Scope | undefined} scope - The scope to set as active, or undefined to clear
 * @returns {void}
 */
export const setActiveScope = scope => {
    activeScope = scope;
};

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
let globalVersion = 0;

/**
 * Scheduler function used to schedule effect execution
 * Defaults to queueMicrotask, can be replaced with setScheduler
 * @type {(callback: () => void) => void}
 */
let scheduler = queueMicrotask;

/**
 * Set a custom scheduler function for effect execution
 * @param {(callback: () => void) => void} newScheduler - The new scheduler function
 * @returns {void}
 */
export const setScheduler = newScheduler => {
    scheduler = newScheduler;
};

/**
 * Creates a reactive scope for tracking effects
 * Effects created within a scope callback are automatically tracked and disposed together
 *
 * @param {ScopeCallback} [callback] - Optional callback to run in scope context
 * @param {Scope | undefined | null} [parent=activeScope] - Parent scope (defaults to activeScope, pass undefined for no parent)
 * @returns {Scope} A scope function that can extend the scope or dispose it
 */
export const scope = (callback, parent = activeScope) => {
    /** @type {Set<() => void>} */
    const effects = new Set();
    /** @type {Set<Scope>} */
    const children = new Set();
    /** @type {Array<() => void>} */
    const cleanups = [];
    let disposed = false;

    const guard = () => {
        if (disposed) throw new Error('Scope is disposed');
    };

    /**
     * Register a cleanup function to run when scope is disposed
     * @param {() => void} cleanup
     */
    const onDispose = cleanup => {
        guard();
        cleanups.push(cleanup);
    };

    /**
     * @type {Scope}
     */
    const ctx = /** @type {Scope} */ (
        cb => {
            guard();

            if (cb === undefined) {
                // Dispose
                disposed = true;

                // Dispose children first (depth-first)
                safeForEach(children);

                // Stop all effects
                safeForEach(effects);
                effects.clear();

                // Run cleanup handlers
                safeForEach(cleanups);

                // Remove from parent
                if (parent) {
                    parent[childrenSymbol].delete(ctx);
                }

                return;
            }

            // Extend scope - run callback in this scope's context
            const prev = activeScope;
            activeScope = ctx;
            try {
                cb(onDispose);
            } finally {
                activeScope = prev;
            }
            return ctx;
        }
    );

    // Internal symbols for effect tracking and child management
    ctx[trackSymbol] = /** @param {() => void} dispose */ dispose => effects.add(dispose);
    ctx[childrenSymbol] = children;

    // Register with parent
    if (parent) parent[childrenSymbol].add(ctx);

    // Run initial callback if provided
    if (callback) ctx(callback);

    return ctx;
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
const makeLive = node => {
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
const makeNonLive = node => {
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
const clearSources = (node, fromIndex = 0) => {
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
    flushScheduled = false;
    const nodes = [...batched];
    batched.clear();
    for (const node of nodes) {
        // Access node to trigger recomputation for effects
        // This will also clear the dirty flag
        node();
    }
};

/**
 * Schedule flush via scheduler (default: microtask)
 */
const scheduleFlush = () => {
    if (!flushScheduled) {
        flushScheduled = true;
        scheduler(flushEffects);
    }
};

/**
 * Track a dependency between currentComputing and a deps Set
 * Uses liveness tracking - only live consumers register with sources
 * @param {Set<Computed<any>>} deps - The dependency set to track
 * @param {Computed<any>} [sourceNode] - The computed node being accessed (if any)
 */
const trackDependency = (deps, sourceNode) => {
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
const markNeedsCheck = node => {
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
        for (const dep of node[dependencies]) {
            markNeedsCheck(dep);
        }
    }
};

/**
 * Mark all dependents in a Set as needing check
 * @param {Set<Computed<any>>} deps - The dependency set to notify
 */
const markDependents = deps => {
    globalVersion++;
    for (const dep of deps) {
        markNeedsCheck(dep);
    }
};

/**
 * Creates a store without an initial object
 * @overload
 * @returns {object}
 */
/**
 * Creates a store with an initial object
 * @template {object} T
 * @overload
 * @param {T} object - Object to make reactive
 * @returns {T}
 */
/**
 * Creates a store
 * @template {object} T
 * @param {T} [object] - Optional object to make reactive
 * @returns {T}
 */
export function state(object = /** @type {T} */ ({})) {
    const proxiesCache = new WeakMap();

    /**
     * Notify dependents of a specific property or all properties
     * @param {object} target
     * @param {string | symbol} [property] - If provided, notifies only this property's dependents. If omitted, notifies all properties' dependents.
     */
    const notifyPropertyDependents = (target, property) => {
        const propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
            /** @type {any} */ (target)[propertyDepsSymbol]
        );
        if (!propsMap) return;
        // If property specified, notify just that property; otherwise notify all
        const depsToNotify = property !== undefined ? [propsMap.get(property)] : propsMap.values();
        for (const deps of depsToNotify) {
            if (deps) {
                markDependents(deps);
            }
        }
    };

    /**
     * @template {object} T
     * @param {T} object
     * @returns {T}
     */
    const createProxy = object => {
        if (proxiesCache.has(object)) {
            return /** @type {T} */ (proxiesCache.get(object));
        }

        // Cache for wrapped methods to avoid creating new functions on every access
        /** @type {Map<string | symbol, Function>} */
        const methodCache = new Map();

        const proxy = new Proxy(object, {
            set(target, p, newValue) {
                warnIfWriteInComputed('state');
                const realValue = unwrapValue(newValue);
                // Use direct property access instead of Reflect for performance
                if (!Object.is(/** @type {Record<string | symbol, any>} */ (target)[p], realValue)) {
                    /** @type {Record<string | symbol, any>} */ (target)[p] = realValue;
                    notifyPropertyDependents(target, p);
                }
                return true;
            },
            get(target, p) {
                if (p === unwrap) return target;
                // Use direct property access instead of Reflect for performance
                const propValue = /** @type {Record<string | symbol, any>} */ (target)[p];

                // Track dependency if we're inside an effect/computed
                if (tracked && currentComputing) {
                    // Get or create the Map for this target (stored as non-enumerable property)
                    let propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
                        /** @type {any} */ (target)[propertyDepsSymbol]
                    );
                    if (!propsMap) {
                        propsMap = new Map();
                        Object.defineProperty(target, propertyDepsSymbol, { value: propsMap });
                    }

                    // Get or create the Set for this property
                    let deps = propsMap.get(p);

                    if (!deps) {
                        // biome-ignore lint/suspicious/noAssignInExpressions: optimization
                        propsMap.set(p, (deps = new Set()));
                    }

                    // Bidirectional linking with optimization
                    trackDependency(deps);
                }

                // Fast path for primitives (most common case)
                const propertyType = typeof propValue;
                if (propValue === null || (propertyType !== 'object' && propertyType !== 'function')) {
                    return propValue;
                }

                // Functions are wrapped to apply with correct `this` (target, not proxy)
                // After function call, notify dependents (function may have mutated internal state)
                if (propertyType === 'function') {
                    // Check cache first to avoid creating new function on every access
                    let cached = methodCache.get(p);
                    if (!cached) {
                        cached = /** @param {...any} args */ (...args) => {
                            // Re-read the method in case it changed
                            const method = /** @type {Function} */ (/** @type {Record<string | symbol, any>} */ (target)[p]);
                            const result = method.apply(target, args.map(unwrapValue));
                            // Notify after function call (function may have mutated state)
                            // Only notify if we're NOT currently inside an effect/computed execution
                            // to avoid infinite loops when reading during effect
                            if (!currentComputing) {
                                notifyPropertyDependents(target);
                            }
                            return result;
                        };
                        methodCache.set(p, cached);
                    }
                    return cached;
                }

                // Object - create nested proxy
                return createProxy(/** @type {any} */ (propValue));
            },
            defineProperty(target, property, attributes) {
                warnIfWriteInComputed('state');
                const result = Reflect.defineProperty(target, property, attributes);
                if (result) {
                    notifyPropertyDependents(target, property);
                }
                return result;
            },
            deleteProperty(target, p) {
                warnIfWriteInComputed('state');
                const result = Reflect.deleteProperty(target, p);
                if (result) {
                    notifyPropertyDependents(target, p);
                    // Clear method cache entry if it was a method
                    methodCache.delete(p);
                }
                return result;
            },
        });
        proxiesCache.set(object, proxy);
        return /** @type {T} */ (proxy);
    };

    return createProxy(object);
}

/**
 * Creates a reactive effect that runs when dependencies change
 * @param {() => void | EffectCleanup} callback - Effect function, can optionally return a cleanup function
 * @returns {() => void} Dispose function to stop the effect
 */
export const effect = callback => {
    /** @type {void | EffectCleanup} */
    let cleanup;

    // Effects use a custom equals that always returns false to ensure they always run
    const comp = /** @type {Computed<void | (() => void)>} */ (
        computed(
            () => {
                // Run previous cleanup if it exists
                if (typeof cleanup === 'function') {
                    cleanup();
                }
                // Run the callback and store new cleanup
                cleanup = callback();
            },
            () => false
        )
    );
    comp[flagsSymbol] |= FLAG_EFFECT;

    // Dispose function for this effect
    const dispose = () => {
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearSources(comp);
        batched.delete(comp);
    };

    // Track to appropriate scope
    if (activeScope) {
        activeScope[trackSymbol](dispose);
    }

    // Trigger first run via batched queue (node is already dirty from computed())
    batched.add(comp);
    scheduleFlush();

    // Return dispose function
    return dispose;
};

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
            tracked = false;
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

        // Reset skipped deps counter for this recomputation
        this[skippedDeps] = 0;

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
            currentComputing = prev;
            tracked = prevTracked;
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

/**
 * Create a simple signal without an initial value
 * @template T
 * @overload
 * @returns {Signal<T | undefined>}
 */
/**
 * Create a simple signal with an initial value
 * @template T
 * @overload
 * @param {T} initialValue - Initial value for the signal
 * @returns {Signal<T>}
 */
/**
 * Create a simple signal
 * @template T
 * @param {T} [initialValue] - Optional initial value for the signal
 * @returns {Signal<T>}
 */
export function signal(initialValue) {
    let value = /** @type {T} */ (initialValue);
    /** @type {Set<Computed<any>> | null} */
    let deps = null;

    /**
     * Read the signal value and track dependency
     * @returns {T}
     */
    const read = () => {
        // Fast path: if not tracked or no current computing, skip tracking
        if (tracked && currentComputing) {
            deps ||= new Set();
            trackDependency(deps);
        }
        return value;
    };

    /**
     * Set a new value and notify dependents
     * @param {T} newValue
     */
    read.set = newValue => {
        warnIfWriteInComputed('signal');
        if (!Object.is(value, newValue)) {
            value = newValue;
            if (deps) markDependents(deps);
        }
    };

    return read;
}

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
