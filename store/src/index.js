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
 * Symbol for dirty flag
 */
const dirty = Symbol();

/**
 * Symbol for the function
 */
const fn = Symbol();

/**
 * Symbol for cached value (computed)
 */
const value = Symbol();

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
    if (fromIndex === 0) {
        sourcesArray.length = 0;
    } else {
        sourcesArray.length = fromIndex;
    }
};

/**
 * Run cleanup function for an effect
 * @param {ComputedNode<any>} comp
 */
const runCleanup = comp => {
    const cleanupFn = comp[value];
    if (typeof cleanupFn === 'function') {
        cleanupFn();
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
 */
const trackDependency = deps => {
    if (!tracked || !currentComputing) return;

    const sourcesArray = currentComputing[sources];
    const skipIndex = currentComputing[skippedDeps];

    if (sourcesArray[skipIndex] === deps) {
        // Same dependency at same position - reuse it!
        // Still need to ensure we're in the deps Set (might have been removed)
        deps.add(currentComputing);
        currentComputing[skippedDeps]++;
    } else {
        // Different dependency - clear old ones from this point and rebuild
        if (skipIndex < sourcesArray.length) {
            clearSources(currentComputing, skipIndex);
        }
        deps.add(currentComputing);
        sourcesArray.push(deps);
        currentComputing[skippedDeps]++;
    }
};

/**
 * Mark a node as dirty and propagate to dependents
 * @param {ComputedNode<any>} node
 */
const markDirty = node => {
    if (!node[dirty]) {
        node[dirty] = true;

        // Propagate to dependents
        for (const dep of node[dependencies]) {
            markDirty(dep);
        }

        // Schedule execution for effects
        if (node[isEffect]) {
            batched.add(node);
            scheduleFlush();
        }
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
     * Mark all dependents in a Set as dirty
     * @param {Set<ComputedNode<any>>} deps
     */
    const markDepsSetDirty = deps => {
        for (const dep of cleared(deps)) {
            markDirty(dep);
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
                    markDepsSetDirty(deps);
                }
            } else {
                // Notify all properties
                for (const deps of propsMap.values()) {
                    markDepsSetDirty(deps);
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
    const comp = /** @type {ComputedNode<void | (() => void)>} */ (computed(callback));
    comp[isEffect] = true;

    // Trigger first run via batched queue (node is already dirty from computed())
    batched.add(comp);
    scheduleFlush();

    // Return dispose function
    return () => {
        // Run final cleanup
        runCleanup(comp);
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
 * @returns {Computed<T>}
 */
export const computed = getter => {
    /** @type {ComputedNode<T>} */
    const comp = {
        [sources]: [],
        [dependencies]: new Set(),
        [dirty]: true,
        [value]: /** @type {T} */ (/** @type {unknown} */ (undefined)),
        [fn]: getter,
        [skippedDeps]: 0,

        get value() {
            // Track if someone is reading us
            trackDependency(this[dependencies]);

            // Recompute if dirty
            if (this[dirty]) {
                this[dirty] = false;

                // For effects: run previous cleanup
                if (this[isEffect]) {
                    runCleanup(this);
                }

                // Reset skipped deps counter for this recomputation
                this[skippedDeps] = 0;

                const prev = currentComputing;
                const prevTracked = tracked;
                currentComputing = this;
                tracked = true; // Computed always tracks its own dependencies
                try {
                    this[value] = this[fn]();
                } catch (e) {
                    // Restore dirty flag on error so it can be retried
                    this[dirty] = true;
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

            return /** @type {T} */ (this[value]);
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
