/**
 * Symbol to unwrap proxy to get underlying object
 */
const unwrap = Symbol();

/**
 * Symbol for sources - what this effect/computed depends on
 */
const sources = Symbol();

/**
 * Symbol for dependencies - effects/computed depending on this
 */
const dependencies = Symbol();

/**
 * Symbol for computation state (discriminated union)
 * Values:
 * - 0: clean (no action needed)
 * - 1: check (might need recomputation, check sources first)
 * - 2: dirty (definitely needs recomputation)
 * - 3: computing (currently executing)
 * - 4: computingDirty (computing but marked for re-run after)
 */
const state = Symbol();

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
 * Symbol for computed nodes we depend on
 */
const sourceNodes = Symbol();

/**
 * @template T
 * @typedef {Record<symbol, any> & { readonly value: T }} ComputedNode
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
 * Atomically copy and clear a Set
 * @template T
 * @param {Set<T>} set
 * @returns {T[]}
 */
const cleared = set => {
    const items = [...set];
    set.clear();
    return items;
};

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
        sourcesArray[i].delete(node);
    }
    sourcesArray.length = fromIndex;
    // Also clear source nodes tracking
    if (node[sourceNodes]) {
        node[sourceNodes].length = fromIndex;
    }
};

/**
 * Schedule flush via microtask
 */
const scheduleFlush = () => {
    if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => {
            flushScheduled = false;
            for (const node of cleared(batched)) {
                // Access .value to trigger recomputation for effects
                // The value getter will clear dirty flag
                node.value;
            }
        });
    }
};

/**
 * Track a dependency between currentComputing and a deps Set
 * @param {Set<ComputedNode<any>>} deps - The dependency set to track
 * @param {ComputedNode<any>} [sourceNode] - The computed node being accessed (if any)
 */
const trackDependency = (deps, sourceNode) => {
    if (!tracked || !currentComputing) return;

    const sourcesArray = currentComputing[sources];
    const skipIndex = currentComputing[skippedDeps];

    if (sourcesArray[skipIndex] !== deps) {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(currentComputing, skipIndex);
        }
        sourcesArray.push(deps);
    }

    deps.add(currentComputing);
    currentComputing[skippedDeps]++;

    // Track source computed node for lazy propagation check
    if (sourceNode) {
        const sourceNodesArray = currentComputing[sourceNodes];
        if (!sourceNodesArray[skipIndex]) {
            sourceNodesArray[skipIndex] = sourceNode;
        }
    }
};

/**
 * Check if node is in a computing state
 * @param {ComputedNode<any>} node
 * @returns {boolean}
 */
const isComputing = node => node[state] === STATE_COMPUTING || node[state] === STATE_COMPUTING_DIRTY;

/**
 * Check if node needs work (check, dirty, or computing-dirty)
 * @param {ComputedNode<any>} node
 * @returns {boolean}
 */
const needsWork = node => node[state] >= STATE_CHECK;

/**
 * Mark a node as needing check (lazy propagation)
 * Only marks the node itself, but recursively finds and marks effect nodes
 * @param {ComputedNode<any>} node
 * @param {boolean} [forceComputing=false] - If true, mark even computing nodes (for store changes)
 */
const markNeedsCheck = (node, forceComputing = false) => {
    const nodeState = node[state];

    // Don't mark nodes that are currently computing - they'll handle their own state
    // Unless forceComputing is true (store changes should still trigger re-run)
    if (isComputing(node)) {
        if (forceComputing && node[isEffect]) {
            // Store changed during effect execution - schedule re-run
            node[state] = STATE_COMPUTING_DIRTY;
            batched.add(node);
            scheduleFlush();
        }
        return;
    }

    if (nodeState === STATE_CLEAN) {
        node[state] = STATE_CHECK;

        // Schedule execution for effects
        if (node[isEffect]) {
            batched.add(node);
            scheduleFlush();
        }

        // Recursively find and mark effect nodes in the dependency tree
        // but don't mark intermediate computed nodes (they use lazy checking)
        for (const dep of node[dependencies]) {
            if (dep[isEffect]) {
                markNeedsCheck(dep);
            } else {
                // For computed nodes, recursively search their dependents for effects
                markEffectsInTree(dep);
            }
        }
    }
};

/**
 * Recursively search for and mark effect nodes without marking intermediate computed nodes
 * @param {ComputedNode<any>} node
 */
const markEffectsInTree = node => {
    if (isComputing(node)) {
        return;
    }
    for (const dep of node[dependencies]) {
        if (dep[isEffect] && dep[state] === STATE_CLEAN) {
            markNeedsCheck(dep);
        } else if (!dep[isEffect]) {
            markEffectsInTree(dep);
        }
    }
};

/**
 * Mark dependents as needing check (when value changed after recomputation)
 * @param {ComputedNode<any>} node
 */
const markDependentsCheck = node => {
    for (const dep of node[dependencies]) {
        markNeedsCheck(dep);
    }
};

/**
 * Creates a store
 * @template {object} T
 * @param {T} [object={}]
 * @returns {T}
 */
export const createStore = (object = /** @type {any} */ ({})) => {
    const proxiesCache = new WeakMap();

    // Per-property dependency tracking
    // Structure: target -> Map(property -> Set<dependents>)
    const propertyDeps = new WeakMap();

    /**
     * Mark all dependents in a Set as needing check
     * @param {Set<ComputedNode<any>>} deps
     */
    const markDepsSetCheck = deps => {
        for (const dep of cleared(deps)) {
            // Store changes should force re-run even for computing effects
            markNeedsCheck(dep, true);
        }
    };

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
                    markDepsSetCheck(deps);
                }
            } else {
                // Notify all properties
                for (const deps of propsMap.values()) {
                    markDepsSetCheck(deps);
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

    // Effects use a custom equals that always returns false to ensure they always run
    const comp = /** @type {ComputedNode<void | (() => void)>} */ (
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
    comp[isEffect] = true;

    // Trigger first run via batched queue (node is already dirty from computed())
    batched.add(comp);
    scheduleFlush();

    // Return dispose function
    return () => {
        // Run final cleanup
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearSources(comp);
        batched.delete(comp);
    };
};

/**
 * @template T
 * @typedef {{ readonly value: T }} Computed
 */

/**
 * Creates a computed value that caches and updates lazily
 * @template T
 * @param {() => T} getter
 * @param {(a: T, b: T) => boolean} [equals=Object.is] - Equality comparison function
 * @returns {Computed<T>}
 */
export const computed = (getter, equals = Object.is) => {
    /** @type {T} */
    let cachedValue;
    let hasValue = false;

    /** @type {ComputedNode<T>} */
    const comp = {
        [sources]: [],
        [sourceNodes]: [],
        [dependencies]: new Set(),
        [state]: STATE_DIRTY,
        [skippedDeps]: 0,

        get value() {
            // Track if someone is reading us
            trackDependency(this[dependencies], this);

            const nodeState = this[state];

            // Check if any source computed nodes have changed values
            // We do this by actually accessing their values, which triggers recomputation
            // and equality checking. If their values haven't changed, they won't mark us.
            // We ALWAYS check sources (not just when marked) to enable lazy propagation.
            if (nodeState === STATE_CLEAN && hasValue) {
                const sourceNodesArray = this[sourceNodes];
                const prevTracked = tracked;
                tracked = false; // Don't track dependencies while checking sources
                try {
                    for (let i = 0; i < sourceNodesArray.length; i++) {
                        const sourceNode = sourceNodesArray[i];
                        if (sourceNode) {
                            // Always access the source value to trigger recursive checking
                            // This allows transitive dependencies to be checked
                            sourceNode.value;
                            // Check if we were marked as a result of the source changing
                            if (needsWork(this)) {
                                break;
                            }
                        }
                    }
                } finally {
                    tracked = prevTracked;
                }
            }

            // Recompute if dirty or needs check
            if (needsWork(this) && !isComputing(this)) {
                const wasDirty = this[state] === STATE_DIRTY;
                this[state] = STATE_COMPUTING;

                // Reset skipped deps counter for this recomputation
                this[skippedDeps] = 0;

                const prev = currentComputing;
                const prevTracked = tracked;
                currentComputing = this;
                tracked = true; // Computed always tracks its own dependencies
                try {
                    const newValue = getter();

                    // Check if value actually changed
                    const changed = !hasValue || !equals(cachedValue, newValue);

                    if (changed) {
                        cachedValue = newValue;
                        hasValue = true;
                        // Value changed - mark dependents as needing check
                        markDependentsCheck(this);
                    } else if (wasDirty) {
                        // Was dirty (first computation or error recovery) but value matches
                        // Still need to mark as having a value
                        hasValue = true;
                    }
                    // If value unchanged and was only checking, don't propagate

                    // Check if we were marked dirty during computation (computingDirty state)
                    // If so, transition to dirty instead of clean
                    this[state] = this[state] === STATE_COMPUTING_DIRTY ? STATE_DIRTY : STATE_CLEAN;
                } catch (e) {
                    // Restore dirty flag on error so it can be retried
                    this[state] = STATE_DIRTY;
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

            return cachedValue;
        },
    };

    return comp;
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
