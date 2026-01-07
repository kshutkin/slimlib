import { DEV } from 'esm-env';

const [
    unwrap,
    sources,
    dependencies,
    flagsSymbol,
    skippedDeps,
    weakRefSymbol,
    lastGlobalVersionSymbol,
    getterSymbol,
    equalsSymbol,
    valueSymbol,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
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
 */
export const debugConfig = flags => {
    debugConfigFlags = flags | 0;
};

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
const FLAG_EFFECT = 1 << 3; // 8 - is an effect (eager execution)
const FLAG_HAS_VALUE = 1 << 4; // 16 - has a cached value
const FLAG_HAS_ERROR = 1 << 5; // 32 - has a cached error (per TC39 Signals proposal)

// Pre-combined flags for faster checks
const FLAG_NEEDS_WORK = FLAG_DIRTY | FLAG_CHECK; // 3 - needs recomputation
const FLAG_COMPUTING_EFFECT = FLAG_COMPUTING | FLAG_EFFECT; // 12 - computing effect
const FLAG_CHECK_ONLY = FLAG_CHECK | FLAG_DIRTY | FLAG_EFFECT; // 11 - for checking if only CHECK is set

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
 * @typedef {((callback: (onDispose: (cleanup: () => void) => void) => void) => Scope) & (() => undefined)} ScopeFunction
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
 */
export const setScheduler = newScheduler => {
    scheduler = newScheduler;
};

/**
 * Creates a reactive scope for tracking effects
 * Effects created within a scope callback are automatically tracked and disposed together
 *
 * @param {((onDispose: (cleanup: () => void) => void) => void) | undefined} [callback] - Optional callback to run in scope context
 * @param {Scope | undefined | null} [parent=activeScope] - Parent scope (defaults to activeScope, pass undefined for no parent)
 * @returns {Scope} A scope function that can extend the scope or dispose it
 *
 * @example
 * // Create a scope with callback
 * const ctx = scope((onDispose) => {
 *   effect(() => { console.log('tracked'); });
 *   onDispose(() => { console.log('cleanup'); });
 * });
 *
 * // Extend the scope
 * ctx((onDispose) => {
 *   effect(() => { console.log('also tracked'); });
 * });
 *
 * // Dispose all effects and run cleanup
 * ctx();
 */
export const scope = (callback, parent = activeScope) => {
    /** @type {Set<() => void>} */
    const effects = new Set();
    /** @type {Set<Scope>} */
    const children = new Set();
    /** @type {Array<() => void>} */
    const cleanups = [];
    let disposed = false;

    /**
     * Register a cleanup function to run when scope is disposed
     * @param {() => void} cleanup
     */
    const onDispose = cleanup => {
        if (disposed) throw new Error('Scope is disposed');
        cleanups.push(cleanup);
    };

    /**
     * @type {Scope}
     */
    const ctx = /** @type {Scope} */ (
        cb => {
            if (disposed) throw new Error('Scope is disposed');

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

                return undefined;
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
 * Clear sources for a node starting from a specific index
 * @param {Computed<any>} node
 * @param {number} fromIndex - Index to start clearing from (default 0 clears all)
 */
const clearSources = (node, fromIndex = 0) => {
    const sourcesArray = node[sources];
    const weakRef = node[weakRefSymbol];
    const len = sourcesArray.length;
    for (let i = fromIndex; i < len; i++) {
        const deps = sourcesArray[i].deps;
        // Check if this deps is retained (exists in kept portion) - avoid removing shared deps
        // This is rare (reading same property multiple times), so linear scan is acceptable
        let isRetained = false;
        for (let j = 0; j < fromIndex; j++) {
            if (sourcesArray[j].deps === deps) {
                isRetained = true;
                break;
            }
        }
        if (!isRetained) {
            deps.delete(weakRef);
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
 * Uses WeakRef to allow automatic GC of unused computeds
 * @param {Set<WeakRef<Computed<any>>>} deps - The dependency set to track (holds WeakRefs)
 * @param {Computed<any>} [sourceNode] - The computed node being accessed (if any)
 */
const trackDependency = (deps, sourceNode) => {
    // Callers guarantee tracked && currentComputing are true
    const node = /** @type {Computed<any>} */ (currentComputing);

    const sourcesArray = node[sources];
    const skipIndex = node[skippedDeps];

    if (sourcesArray[skipIndex]?.deps !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(node, skipIndex);
        }
        // Use cached WeakRef from the node (create lazily on first use)
        let weakRef = node[weakRefSymbol];
        if (!weakRef) {
            weakRef = new WeakRef(node);
            node[weakRefSymbol] = weakRef;
        }
        sourcesArray.push({ deps, node: sourceNode });
        deps.add(weakRef);
    }
    // If reusing existing entry, weakRef is already in deps

    ++node[skippedDeps];
};

/**
 * Schedule an effect for execution
 * @param {Computed<any>} node
 */
const scheduleEffect = node => {
    batched.add(node);
    scheduleFlush();
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * Marks the node and recursively marks all dependents in a single traversal
 * @param {Computed<any>} node
 */
const markNeedsCheck = node => {
    const flags = node[flagsSymbol];

    // Don't mark nodes that are currently computing - they'll handle their own state
    // Exception: effects that have store changes during execution should still be scheduled for re-run
    if ((flags & FLAG_COMPUTING_EFFECT) === FLAG_COMPUTING_EFFECT) {
        // Computing effect with store change - schedule re-run
        node[flagsSymbol] = flags | FLAG_DIRTY;
        scheduleEffect(node);
        return;
    }

    if (flags & FLAG_COMPUTING) {
        // Computing but not an effect - just return
        return;
    }

    // Only propagate if node is clean (no dirty or check flags set)
    if (!(flags & FLAG_NEEDS_WORK)) {
        node[flagsSymbol] = flags | FLAG_CHECK;

        // Schedule execution for effects
        if (flags & FLAG_EFFECT) {
            scheduleEffect(node);
        }

        // Recursively mark ALL dependents (single traversal optimization)
        markDependents(node[dependencies]);
    }
};

/**
 * Iterate over a WeakRef set, calling callback for each live dep and cleaning up dead ones
 * @param {Set<WeakRef<Computed<any>>>} deps - The dependency set to iterate (holds WeakRefs)
 * @param {(dep: Computed<any>) => void} callback - Function to call for each live dependency
 */
const forEachDep = (deps, callback) => {
    for (const weakRef of deps) {
        const dep = weakRef.deref();
        if (dep) {
            callback(dep);
        } else {
            // Computed was GC'd, clean up dead WeakRef
            deps.delete(weakRef);
        }
    }
};

/**
 * Mark all dependents in a Set as needing check
 * Unified notification function for both computed and state dependencies
 * @param {Set<WeakRef<Computed<any>>>} deps - The dependency set to notify (holds WeakRefs)
 */
const markDependents = deps => {
    globalVersion++;
    forEachDep(deps, markNeedsCheck);
};

/**
 * Creates a store
 * @template {object} T
 * @param {T} [object={}]
 * @returns {T}
 */
export const state = (object = /** @type {any} */ ({})) => {
    const proxiesCache = new WeakMap();

    /**
     * Notify dependents of a specific property or all properties
     * @param {object} target
     * @param {string | symbol} [property] - If provided, notifies only this property's dependents. If omitted, notifies all properties' dependents.
     */
    const notifyPropertyDependents = (target, property) => {
        const propsMap = /** @type {Map<string | symbol, Set<WeakRef<Computed<any>>>> | undefined} */ (
            /** @type {any} */ (target)[propertyDepsSymbol]
        );
        if (propsMap) {
            if (property !== undefined) {
                // Notify specific property
                const deps = propsMap.get(property);
                if (deps) {
                    markDependents(deps);
                }
            } else {
                // Notify all properties
                for (const deps of propsMap.values()) {
                    markDependents(deps);
                }
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
                    let propsMap = /** @type {Map<string | symbol, Set<WeakRef<Computed<any>>>> | undefined} */ (
                        /** @type {any} */ (target)[propertyDepsSymbol]
                    );
                    if (!propsMap) {
                        propsMap = new Map();
                        Object.defineProperty(target, propertyDepsSymbol, {
                            value: propsMap,
                            enumerable: false,
                            configurable: false,
                            writable: false,
                        });
                    }

                    // Get or create the Set for this property
                    let deps = propsMap.get(p);
                    if (!deps) {
                        deps = new Set();
                        propsMap.set(p, deps);
                    }

                    // Bidirectional linking with optimization
                    trackDependency(deps);
                }

                // Fast path for primitives (most common case)
                if (propValue === null || (typeof propValue !== 'object' && typeof propValue !== 'function')) {
                    return propValue;
                }

                // Functions are wrapped to apply with correct `this` (target, not proxy)
                // After function call, notify dependents (function may have mutated internal state)
                if (typeof propValue === 'function') {
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
};

/**
 * Creates a reactive effect that re-runs when its dependencies change
 * @param {() => void | (() => void)} callback - Effect function, can return cleanup
 * @returns {() => void} Dispose function
 */
export const effect = callback => {
    /** @type {void | (() => void)} */
    let cleanup;

    const runCleanup = () => {
        if (typeof cleanup === 'function') {
            cleanup();
        }
    };

    // Effects use a custom equals that always returns false to ensure they always run
    const comp = /** @type {Computed<void | (() => void)>} */ (
        computed(
            () => {
                // Run previous cleanup if it exists
                runCleanup();
                // Run the callback and store new cleanup
                cleanup = callback();
            },
            () => false
        )
    );
    comp[flagsSymbol] |= FLAG_EFFECT;

    // Dispose function for this effect
    const dispose = () => {
        // Run final cleanup
        runCleanup();
        clearSources(comp);
        batched.delete(comp);
    };

    // Track to appropriate scope
    const targetScope = activeScope;
    if (targetScope) {
        targetScope[trackSymbol](dispose);
    }

    // Trigger first run via batched queue (node is already dirty from computed())
    scheduleEffect(comp);

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

    // For CHECK state, verify if sources actually changed before recomputing
    // This preserves the equality cutoff optimization with eager marking
    // Only do this for non-effects that ONLY have computed sources (with nodes)
    // Effects should always run when marked, and state deps have no node to check
    if ((flags & (FLAG_CHECK_ONLY | FLAG_HAS_VALUE)) === (FLAG_CHECK | FLAG_HAS_VALUE)) {
        const sourcesArray = this[sources];
        const len = sourcesArray.length;

        // Fast path: check if all sources have nodes (are computed, not state)
        // Do this inline to avoid separate loop
        let allComputed = len > 0;
        for (let i = 0; i < len && allComputed; i++) {
            if (!sourcesArray[i].node) {
                allComputed = false;
            }
        }

        // Only do source checking if we ONLY have computed sources
        // If we have state sources, we can't verify them - must recompute
        if (allComputed) {
            // Inline untracked to avoid function call overhead
            const prevTracked = tracked;
            tracked = false;
            try {
                for (let i = 0; i < len; i++) {
                    // Access source to trigger its recomputation if needed
                    sourcesArray[i].node();
                }
            } finally {
                tracked = prevTracked;
            }
            // If we're still CHECK after checking all sources, no source changed value
            // We can safely mark as clean and skip recomputation
            flags = this[flagsSymbol];
            if ((flags & FLAG_NEEDS_WORK) === FLAG_CHECK) {
                this[flagsSymbol] = flags & ~FLAG_CHECK;
            }
        }
    }

    // Recompute if dirty or check (sources actually changed)
    // Note: FLAG_COMPUTING check is now redundant here since we throw above,
    // but kept for safety in case of future refactoring
    flags = this[flagsSymbol];
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
                // Set has value flag and clear error flag (single bitmask operation)
                this[flagsSymbol] = (this[flagsSymbol] | FLAG_HAS_VALUE) & ~FLAG_HAS_ERROR;
                // Value changed - mark dependents as DIRTY (not just CHECK)
                // so they know they definitely need to recompute
                forEachDep(this[dependencies], dep => {
                    const depFlags = dep[flagsSymbol];
                    if ((depFlags & (FLAG_COMPUTING | FLAG_NEEDS_WORK)) === FLAG_CHECK) {
                        dep[flagsSymbol] = depFlags | FLAG_DIRTY;
                    }
                });
            } else if (wasDirty) {
                // Was dirty (first computation) but value matches
                // Still need to mark as having a value
                this[flagsSymbol] |= FLAG_HAS_VALUE;
            }
            // If value unchanged and was only checking, don't propagate

            // Check if we were marked dirty during computation
            // If so, keep dirty flag, otherwise clear computing
            const endFlags = this[flagsSymbol];
            this[flagsSymbol] = endFlags & ~FLAG_COMPUTING;

            // Update last seen global version
            this[lastGlobalVersionSymbol] = globalVersion;
        } catch (e) {
            // Per TC39 Signals proposal: cache the error and mark as clean with error flag
            // The error will be rethrown on subsequent reads until a dependency changes
            // Reuse valueSymbol for error storage since a computed can't have both value and error
            this[valueSymbol] = e;
            this[flagsSymbol] = (this[flagsSymbol] & ~(FLAG_COMPUTING | FLAG_NEEDS_WORK | FLAG_HAS_VALUE)) | FLAG_HAS_ERROR;
            this[lastGlobalVersionSymbol] = globalVersion;
        } finally {
            currentComputing = prev;
            tracked = prevTracked;
            // Clean up any excess sources that weren't reused
            if (this[sources].length > this[skippedDeps]) {
                clearSources(this, this[skippedDeps]);
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

    return context;
};

/**
 * Create a simple signal
 * @template T
 * @param {T} [initialValue] - Optional initial value
 * @returns {(() => T) & { set: (value: T) => void }}
 */
export const signal = initialValue => {
    let value = /** @type {T} */ (initialValue);
    /** @type {Set<WeakRef<Computed<any>>> | null} */
    let deps = null;

    /**
     * Read the signal value and track dependency
     * @returns {T}
     */
    const read = () => {
        // Fast path: if not tracked or no current computing, skip tracking
        if (tracked && currentComputing) {
            if (!deps) deps = new Set();
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
