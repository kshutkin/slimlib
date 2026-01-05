/**
 * Symbol to unwrap proxy to get underlying object
 */
const unwrap = Symbol();

/**
 * Symbol for sources - what this effect/computed depends on
 * Each entry is { deps: Set<WeakRef<ComputedNode>>, node?: ComputedNode, weakRef: WeakRef<ComputedNode> }
 *
 * The `node` field is a STRONG reference to the source computed - this is semantically
 * necessary because a computed needs its sources to exist to compute its value.
 *
 * The `weakRef` field stores our own WeakRef so we can properly remove it from the deps Set
 * during cleanup (clearSources).
 */
const sources = Symbol();

/**
 * Symbol for dependencies - effects/computed depending on this
 *
 * Dependencies are stored as WeakRefs to allow automatic garbage collection of unused computeds.
 * When a computed is no longer referenced by user code and has no dependents, it can be GC'd
 * even if its sources (state or other computeds) are still alive.
 *
 * This enables memory-efficient patterns in long-running applications where computeds are
 * dynamically created and discarded.
 */
const dependencies = Symbol();

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

/**
 * Symbol for computation state (discriminated union)
 * Values:
 * - 0: clean (no action needed)
 * - 1: check (might need recomputation, check sources first)
 * - 2: dirty (definitely needs recomputation)
 * - 3: computing (currently executing)
 * - 4: computingDirty (computing but marked for re-run after)
 */
const nodeStateSymbol = Symbol();

// State constants
const STATE_CLEAN = 0;
const STATE_CHECK = 1;
const STATE_DIRTY = 2;
const STATE_COMPUTING = 3;
const STATE_COMPUTING_DIRTY = 4;

/**
 * Symbol to mark a node as an effect (eager execution)
 */
const isEffect = Symbol();

/**
 * Symbol for skipped dependencies counter (optimization)
 */
const skippedDeps = Symbol();

/**
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any }} ComputedNode
 */

// Global state
/** @type {ComputedNode<any> | null} */
let currentComputing = null;
/** @type {Set<ComputedNode<any>>} */
const batched = new Set();
let flushScheduled = false;
let tracked = true;

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
    for (let i = fromIndex; i < sourcesArray.length; i++) {
        // Delete our specific WeakRef from the deps Set
        sourcesArray[i].deps.delete(sourcesArray[i].weakRef);
    }
    sourcesArray.length = fromIndex;
};

/**
 * Schedule flush via microtask
 */
const scheduleFlush = () => {
    if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => {
            flushScheduled = false;
            const nodes = [...batched];
            batched.clear();
            for (const node of nodes) {
                // Access getValue() to trigger recomputation for effects
                // The getValue method will clear dirty flag
                node();
            }
        });
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
        // Create WeakRef and store it for later cleanup
        const weakRef = new WeakRef(currentComputing);
        sourcesArray.push({ deps, node: sourceNode, weakRef });
        deps.add(weakRef);
    }
    // If reusing existing entry, weakRef is already in deps

    ++currentComputing[skippedDeps];
};

/**
 * Check if node is in a computing state
 * @param {ComputedNode<any>} node
 * @returns {boolean}
 */
const isComputing = node => node[nodeStateSymbol] === STATE_COMPUTING || node[nodeStateSymbol] === STATE_COMPUTING_DIRTY;

/**
 * Check if node needs work (check, dirty, or computing-dirty)
 * @param {ComputedNode<any>} node
 * @returns {boolean}
 */
const needsWork = node => node[nodeStateSymbol] >= STATE_CHECK;

/**
 * Mark a node as needing check (eager propagation with equality cutoff)
 * Marks the node and recursively marks all dependents in a single traversal
 * @param {ComputedNode<any>} node
 */
/**
 * Schedule an effect for execution
 * @param {ComputedNode<any>} node
 */
const scheduleEffect = node => {
    batched.add(node);
    scheduleFlush();
};

const markNeedsCheck = node => {
    // Don't mark nodes that are currently computing - they'll handle their own state
    // Unless forceComputing is true (store changes should still trigger re-run)
    if (isComputing(node)) {
        if (node[isEffect]) {
            // Store changed during effect execution - schedule re-run
            node[nodeStateSymbol] = STATE_COMPUTING_DIRTY;
            scheduleEffect(node);
        }
        return;
    }

    if (node[nodeStateSymbol] === STATE_CLEAN) {
        node[nodeStateSymbol] = STATE_CHECK;

        // Schedule execution for effects
        if (node[isEffect]) {
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
                // After function call, mark deps dirty (function may have mutated internal state)
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
    comp[isEffect] = true;

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
 * Creates a computed node (internal implementation)
 * @template T
 * @param {() => T} getter
 * @param {(a: T, b: T) => boolean} [equals=Object.is] - Equality comparison function
 * @returns {ComputedNode<T>}
 */
export const computed = (getter, equals = Object.is) => {
    /** @type {T} */
    let cachedValue;
    let hasValue = false;

    const context = /** @type {ComputedNode<T>} */ (
        /** @type {unknown} */ (
            Object.assign(
                () => {
                    // Track if someone is reading us
                    trackDependency(context[dependencies], context);

                    const nodeState = context[nodeStateSymbol];

                    // For CHECK state, verify if sources actually changed before recomputing
                    // This preserves the equality cutoff optimization with eager marking
                    // Only do this for non-effects that ONLY have computed sources (with nodes)
                    // Effects should always run when marked, and state deps have no node to check
                    if (nodeState === STATE_CHECK && hasValue && !context[isEffect]) {
                        const sourcesArray = context[sources];
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
                            if (context[nodeStateSymbol] === STATE_CHECK) {
                                context[nodeStateSymbol] = STATE_CLEAN;
                            }
                        }
                    }

                    // Recompute if dirty (sources actually changed)
                    if (needsWork(context) && !isComputing(context)) {
                        const wasDirty = context[nodeStateSymbol] === STATE_DIRTY;
                        context[nodeStateSymbol] = STATE_COMPUTING;

                        // Reset skipped deps counter for this recomputation
                        context[skippedDeps] = 0;

                        const prev = currentComputing;
                        const prevTracked = tracked;
                        currentComputing = context;
                        tracked = true; // Computed always tracks its own dependencies
                        try {
                            const newValue = getter();

                            // Check if value actually changed
                            const changed = !hasValue || !equals(cachedValue, newValue);

                            if (changed) {
                                cachedValue = newValue;
                                hasValue = true;
                                // Value changed - mark dependents as DIRTY (not just CHECK)
                                // so they know they definitely need to recompute
                                forEachDep(context[dependencies], dep => {
                                    if (!isComputing(dep) && dep[nodeStateSymbol] === STATE_CHECK) {
                                        dep[nodeStateSymbol] = STATE_DIRTY;
                                    }
                                });
                            } else if (wasDirty) {
                                // Was dirty (first computation or error recovery) but value matches
                                // Still need to mark as having a value
                                hasValue = true;
                            }
                            // If value unchanged and was only checking, don't propagate

                            // Check if we were marked dirty during computation (computingDirty state)
                            // If so, transition to dirty instead of clean
                            context[nodeStateSymbol] = context[nodeStateSymbol] === STATE_COMPUTING_DIRTY ? STATE_DIRTY : STATE_CLEAN;
                        } catch (e) {
                            // Restore dirty flag on error so it can be retried
                            context[nodeStateSymbol] = STATE_DIRTY;
                            throw e;
                        } finally {
                            currentComputing = prev;
                            tracked = prevTracked;
                            // Clean up any excess sources that weren't reused
                            if (context[sources].length > context[skippedDeps]) {
                                clearSources(context, context[skippedDeps]);
                            }
                        }
                    }

                    return cachedValue;
                },
                {
                    [sources]: [],
                    [dependencies]: new Set(),
                    [nodeStateSymbol]: STATE_DIRTY,
                    [skippedDeps]: 0,
                }
            )
        )
    );

    return context;
};

/**
 * Create a simple signal
 * @template T
 * @param {T} [initialValue] - Optional initial value
 * @returns {(() => T) & { set: (value: T) => void }}
 */
export const signal = initialValue => {
    let value = initialValue;
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
