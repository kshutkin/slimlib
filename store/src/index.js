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
] =
    /** @type {[import('./symbols').unwrap, import('./symbols').sources, import('./symbols').dependencies, import('./symbols').flagsSymbol, import('./symbols').skippedDeps, import('./symbols').weakRefSymbol, import('./symbols').lastGlobalVersionSymbol, import('./symbols').getterSymbol, import('./symbols').equalsSymbol, import('./symbols').valueSymbol, symbol]}*/ (
        /** @type {unknown}*/ (Array.from({ length: 11 }, () => Symbol()))
    );

// Bit flags for node state
const FLAG_DIRTY = 1 << 0; // 1 - definitely needs recomputation
const FLAG_CHECK = 1 << 1; // 2 - might need recomputation, check sources first
const FLAG_COMPUTING = 1 << 2; // 4 - currently executing
const FLAG_EFFECT = 1 << 3; // 8 - is an effect (eager execution)
const FLAG_HAS_VALUE = 1 << 4; // 16 - has a cached value

// Pre-combined flags for faster checks
const FLAG_NEEDS_WORK = FLAG_DIRTY | FLAG_CHECK; // 3 - needs recomputation
const FLAG_COMPUTING_EFFECT = FLAG_COMPUTING | FLAG_EFFECT; // 12 - computing effect
const FLAG_CHECK_ONLY = FLAG_CHECK | FLAG_DIRTY | FLAG_EFFECT; // 11 - for checking if only CHECK is set

/**
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any }} ComputedNode
 */

// Global state
/** @type {ComputedNode<any> | null} */
let currentComputing = null;
/** @type {Set<ComputedNode<any>>} */
const batched = new Set();
/**
 * Set holding strong references to active effects
 * Effects are added when created and removed when disposed
 * This prevents effects from being garbage collected while still active
 */
const activeEffects = new Set();
let flushScheduled = false;
let tracked = true;

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
 * Unwraps a proxied value to get the underlying object
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const unwrapValue = value => (value != null && /** @type {Record<symbol, any>} */ (/** @type {unknown} */ (value))[unwrap]) || value;

/**
 * Clear sources for a node starting from a specific index
 * @param {ComputedNode<any>} node
 * @param {number} fromIndex - Index to start clearing from (default 0 clears all)
 */
const clearSources = (node, fromIndex = 0) => {
    const sourcesArray = node[sources];
    const weakRef = node[weakRefSymbol];
    for (let i = fromIndex; i < sourcesArray.length; i++) {
        // Delete our cached WeakRef from the deps Set
        sourcesArray[i].deps.delete(weakRef);
    }
    sourcesArray.length = fromIndex;
};

/**
 * Execute all pending effects immediately
 * This function can be called to manually trigger all scheduled effects
 * before the next microtask
 */
export const flush = () => {
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
        scheduler(flush);
    }
};

/**
 * Track a dependency between currentComputing and a deps Set
 * Uses WeakRef to allow automatic GC of unused computeds
 * @param {Set<WeakRef<ComputedNode<any>>>} deps - The dependency set to track (holds WeakRefs)
 * @param {ComputedNode<any>} [sourceNode] - The computed node being accessed (if any)
 */
const trackDependency = (deps, sourceNode) => {
    // Callers guarantee tracked && currentComputing are true
    const node = /** @type {ComputedNode<any>} */ (currentComputing);

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
 * @param {ComputedNode<any>} node
 */
const scheduleEffect = node => {
    batched.add(node);
    scheduleFlush();
};

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * Marks the node and recursively marks all dependents in a single traversal
 * @param {ComputedNode<any>} node
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
 * @param {Set<WeakRef<ComputedNode<any>>>} deps - The dependency set to iterate (holds WeakRefs)
 * @param {(dep: ComputedNode<any>) => void} callback - Function to call for each live dependency
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
 * @param {Set<WeakRef<ComputedNode<any>>>} deps - The dependency set to notify (holds WeakRefs)
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
        const propsMap = /** @type {Map<string | symbol, Set<WeakRef<ComputedNode<any>>>> | undefined} */ (
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
                    let propsMap = /** @type {Map<string | symbol, Set<WeakRef<ComputedNode<any>>>> | undefined} */ (
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
                const result = Reflect.defineProperty(target, property, attributes);
                if (result) {
                    notifyPropertyDependents(target, property);
                }
                return result;
            },
            deleteProperty(target, p) {
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
    const comp = /** @type {ComputedNode<void | (() => void)>} */ (
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

    // Keep effect alive until disposed
    activeEffects.add(comp);

    // Trigger first run via batched queue (node is already dirty from computed())
    scheduleEffect(comp);

    // Return dispose function
    return () => {
        // Run final cleanup
        runCleanup();
        clearSources(comp);
        batched.delete(comp);
        activeEffects.delete(comp);
    };
};

/**
 * @template T
 * @typedef {() => T} Computed
 */

/**
 * Read function for computed nodes
 * @this {ComputedNode<any>}
 * @returns {any}
 */
function computedRead() {
    // Track if someone is reading us
    if (tracked && currentComputing) {
        trackDependency(this[dependencies], this);
    }

    let flags = this[flagsSymbol];

    // Fast-path: if node is clean and nothing has changed globally since last read, return cached value
    if ((flags & (FLAG_HAS_VALUE | FLAG_NEEDS_WORK)) === FLAG_HAS_VALUE && this[lastGlobalVersionSymbol] === globalVersion) {
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
    flags = this[flagsSymbol];
    if (flags & FLAG_NEEDS_WORK && !(flags & FLAG_COMPUTING)) {
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

            // Check if value actually changed
            const changed = !(flags & FLAG_HAS_VALUE) || !this[equalsSymbol](this[valueSymbol], newValue);

            if (changed) {
                this[valueSymbol] = newValue;
                this[flagsSymbol] |= FLAG_HAS_VALUE;
                // Value changed - mark dependents as DIRTY (not just CHECK)
                // so they know they definitely need to recompute
                forEachDep(this[dependencies], dep => {
                    const depFlags = dep[flagsSymbol];
                    if ((depFlags & (FLAG_COMPUTING | FLAG_NEEDS_WORK)) === FLAG_CHECK) {
                        dep[flagsSymbol] = depFlags | FLAG_DIRTY;
                    }
                });
            } else if (wasDirty) {
                // Was dirty (first computation or error recovery) but value matches
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
            // Restore dirty flag on error so it can be retried
            this[flagsSymbol] = (this[flagsSymbol] & ~FLAG_COMPUTING) | FLAG_DIRTY;
            throw e;
        } finally {
            currentComputing = prev;
            tracked = prevTracked;
            // Clean up any excess sources that weren't reused
            if (this[sources].length > this[skippedDeps]) {
                clearSources(this, this[skippedDeps]);
            }
        }
    }

    return this[valueSymbol];
}

/**
 * Creates a computed value that automatically tracks dependencies and caches results
 * @template T
 * @param {() => T} getter
 * @param {(a: T, b: T) => boolean} [equals=Object.is] - Equality comparison function
 * @returns {ComputedNode<T>}
 */
export const computed = (getter, equals = Object.is) => {
    // Create callable that invokes computedRead with itself as `this`
    const context = /** @type {ComputedNode<T>} */ (() => computedRead.call(context));

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
    /** @type {Set<WeakRef<ComputedNode<any>>> | null} */
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
