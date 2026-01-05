/**
 * @typedef {import('./symbols').unwrap} unwrap
 * @typedef {import('./symbols').sources} sources
 * @typedef {import('./symbols').dependencies} dependencies
 * @typedef {import('./symbols').flagsSymbol} flagsSymbol
 * @typedef {import('./symbols').skippedDeps} skippedDeps
 * @typedef {import('./symbols').weakRefSymbol} weakRefSymbol
 * @typedef {import('./symbols').lastGlobalVersionSymbol} lastGlobalVersionSymbol
 * @typedef {import('./symbols').getterSymbol} getterSymbol
 * @typedef {import('./symbols').equalsSymbol} equalsSymbol
 * @typedef {import('./symbols').valueSymbol} valueSymbol
 */

/**
 * Symbols used throughout the store:
 * - unwrap: to unwrap proxy to get underlying object
 * - sources: what this effect/computed depends on
 *   Each entry is { deps: Set<WeakRef<ComputedNode>>, node?: ComputedNode, weakRef: WeakRef<ComputedNode> }
 *   The `node` field is a STRONG reference to the source computed - this is semantically
 *   necessary because a computed needs its sources to exist to compute its value.
 *   The `weakRef` field stores our own WeakRef so we can properly remove it from the deps Set
 *   during cleanup (clearSources).
 * - dependencies: effects/computed depending on this
 *   Dependencies are stored as WeakRefs to allow automatic garbage collection of unused computeds.
 *   When a computed is no longer referenced by user code and has no dependents, it can be GC'd
 *   even if its sources (state or other computeds) are still alive.
 *   This enables memory-efficient patterns in long-running applications where computeds are
 *   dynamically created and discarded.
 * - flagsSymbol: computation state (bit flags)
 * - skippedDeps: skipped dependencies counter (optimization)
 * - weakRefSymbol: cached WeakRef of a computed node (avoids creating new WeakRef per dependency)
 * - lastGlobalVersionSymbol: storing the last seen global version on a computed node
 * - getterSymbol: getter function for computed
 * - equalsSymbol: equality function for computed
 * - valueSymbol: cached value for computed
 */
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
] =
    /** @type {[unwrap, sources, dependencies, flagsSymbol, skippedDeps, weakRefSymbol, lastGlobalVersionSymbol, getterSymbol, equalsSymbol, valueSymbol]}*/ (
        /** @type {unknown}*/ (Array.from({ length: 10 }, () => Symbol()))
    );

/**
 * Module-level WeakMap for property-level dependencies on state objects
 * Structure: target -> Map<property, Set<WeakRef<ComputedNode>>>
 *
 * Uses WeakMap with target as key, so when a state object is GC'd, all its dependency
 * tracking is automatically cleaned up.
 *
 * Property dependencies are stored as WeakRefs to allow automatic GC of unused computeds.
 */
const propertyDeps = new WeakMap();

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

/**
 * Prototype for computed nodes - contains the read logic
 * Using a prototype allows V8 to optimize property access
 */
const ComputedProto = {
    [sources]: [],
    [dependencies]: null,
    [flagsSymbol]: FLAG_DIRTY,
    [skippedDeps]: 0,
    [weakRefSymbol]: undefined,
    [lastGlobalVersionSymbol]: 0,
    [getterSymbol]: null, // getter
    [equalsSymbol]: null, // equals
    [valueSymbol]: undefined, // cached value
};

// Global state
/** @type {ComputedNode<any> | null} */
let currentComputing = null;
/** @type {Set<ComputedNode<any>>} */
const batched = new Set();
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
 * @template T
 * @typedef {T & {[unwrap]: T}} Unwrappable
 */

/**
 * Unwraps a proxied value to get the underlying object
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const unwrapValue = value => (value != null && /** @type {Unwrappable<T>} */ (value)[unwrap]) || value;

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
    if (!tracked || !currentComputing) return;

    const sourcesArray = currentComputing[sources];
    const skipIndex = currentComputing[skippedDeps];

    if (sourcesArray[skipIndex]?.deps !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(currentComputing, skipIndex);
        }
        // Use cached WeakRef from the node (create lazily on first use)
        let weakRef = currentComputing[weakRefSymbol];
        if (!weakRef) {
            weakRef = new WeakRef(currentComputing);
            currentComputing[weakRefSymbol] = weakRef;
        }
        sourcesArray.push({ deps, node: sourceNode });
        deps.add(weakRef);
    }
    // If reusing existing entry, weakRef is already in deps

    ++currentComputing[skippedDeps];
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
        const propsMap = propertyDeps.get(target);
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

        const proxy = new Proxy(object, {
            set(target, p, newValue, receiver) {
                const realValue = unwrapValue(newValue);
                if (!Object.is(Reflect.get(target, p, receiver), realValue)) {
                    Reflect.set(target, p, realValue, receiver);
                    notifyPropertyDependents(target, p);
                }
                return true;
            },
            get(target, p) {
                if (p === unwrap) return target;
                const propValue = Reflect.get(target, p);
                const valueType = typeof propValue;

                // Track dependency if we're inside an effect/computed
                if (tracked && currentComputing) {
                    // Get or create the Map for this target
                    let propsMap = propertyDeps.get(target);
                    if (!propsMap) {
                        propsMap = new Map();
                        propertyDeps.set(target, propsMap);
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

                // Functions are wrapped to apply with correct `this` (target, not proxy)
                // After function call, notify dependents (function may have mutated internal state)
                return valueType === 'function'
                    ? /** @param {...any} args */ (...args) => {
                          const result = /** @type {Function} */ (propValue).apply(target, args.map(unwrapValue));
                          // Notify after function call (function may have mutated state)
                          // Only notify if we're NOT currently inside an effect/computed execution
                          // to avoid infinite loops when reading during effect
                          if (!currentComputing) {
                              notifyPropertyDependents(target);
                          }
                          return result;
                      }
                    : propValue !== null && valueType === 'object'
                      ? createProxy(/** @type {any} */ (propValue))
                      : propValue;
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

    // Trigger first run via batched queue (node is already dirty from computed())
    scheduleEffect(comp);

    // Return dispose function
    return () => {
        // Run final cleanup
        runCleanup();
        clearSources(comp);
        batched.delete(comp);
    };
};

/**
 * @template T
 * @typedef {() => T} Computed
 */

/**
 * Read function for computed nodes - extracted for prototype-based approach
 * @this {ComputedNode<any>}
 * @returns {any}
 */
function computedRead() {
    // Track if someone is reading us
    trackDependency(this[dependencies], this);

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
        // Check if we have any computed sources to verify
        let hasComputedSources = false;
        let hasStateSources = false;
        for (const source of sourcesArray) {
            if (source.node) {
                hasComputedSources = true;
            } else {
                hasStateSources = true;
            }
        }

        // Only do source checking if we ONLY have computed sources
        // If we have state sources, we can't verify them - must recompute
        if (hasComputedSources && !hasStateSources) {
            untracked(() => {
                for (const source of sourcesArray) {
                    // Access source to trigger its recomputation if needed
                    // We know all sources have nodes (hasComputedSources && !hasStateSources)
                    source.node();
                }
            });
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
    // Create a callable function that delegates to computedRead
    const context = /** @type {ComputedNode<T>} */ (() => computedRead.call(context));

    // Set prototype for optimized property access
    Object.setPrototypeOf(context, ComputedProto);

    // Initialize instance-specific properties
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
    /** @type {Set<WeakRef<ComputedNode<any>>>} */
    const deps = new Set();

    /**
     * Read the signal value and track dependency
     * @returns {T}
     */
    const read = () => {
        trackDependency(deps);
        return value;
    };

    /**
     * Set a new value and notify dependents
     * @param {T} newValue
     */
    read.set = newValue => {
        if (value !== newValue) {
            value = newValue;
            markDependents(deps);
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
