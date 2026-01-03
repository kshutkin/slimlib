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
 * Symbol to distinguish effect from computed
 */
const isEffect = Symbol();

/**
 * Symbol for cleanup function
 */
const cleanup = Symbol();

/**
 * @typedef {Record<symbol, any>} EffectNode
 */

/**
 * @template T
 * @typedef {Record<symbol, any>} ComputedNode
 */

// Global state
/** @type {EffectNode | ComputedNode<any> | null} */
let currentComputing = null;
/** @type {Set<EffectNode>} */
const batched = new Set();
let flushScheduled = false;
let tracked = true;
/** @type {Set<ComputedNode<any>>} */
const computingStack = new Set(); // For circular dependency detection

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
 * Clear all sources for a node (effect/computed)
 * @param {EffectNode | ComputedNode<any>} node
 */
const clearSources = node => {
    const nodeSources = node[sources];
    for (const source of nodeSources) {
        if (source.deps) {
            // Property dependency
            source.deps.delete(node);
        } else if (source.computed) {
            // Computed dependency
            source.computed[dependencies].delete(node);
        }
    }
    nodeSources.clear();
};

/**
 * Schedule flush via microtask
 */
const scheduleFlush = () => {
    if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
    }
};

/**
 * Execute batched effects
 */
const flush = () => {
    flushScheduled = false;

    const toRun = [...batched];
    batched.clear();

    for (const node of toRun) {
        // Only run if still dirty (handles diamond problem)
        if (node[dirty]) {
            node[dirty] = false;
            node[fn]();
        }
    }
};

/**
 * Mark a node as dirty and propagate to dependents
 * @param {EffectNode | ComputedNode<any>} node
 */
const markDirty = node => {
    if (!node[dirty]) {
        node[dirty] = true;

        // Propagate to dependents (for computed values)
        if (node[dependencies]) {
            for (const dep of node[dependencies]) {
                markDirty(dep);
            }
        }

        // Schedule execution (only for effects)
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
     * @template {object} T
     * @param {T} object
     * @returns {T}
     */
    const createProxy = object => {
        if (proxiesCache.has(object)) {
            return /** @type {T} */ (proxiesCache.get(object));
        } else {
            const proxy = new Proxy(object, {
                set(target, p, newValue, receiver) {
                    const realValue = unwrapValue(newValue);
                    if (Reflect.get(target, p, receiver) !== realValue) {
                        Reflect.set(target, p, realValue, receiver);

                        // Notify dependents of this specific property
                        const propsMap = propertyDeps.get(target);
                        if (propsMap) {
                            const deps = propsMap.get(p);
                            if (deps) {
                                const depsArray = [...deps];
                                for (const dep of depsArray) {
                                    deps.delete(dep); // Clear (will re-subscribe on re-run)
                                    markDirty(dep);
                                }
                            }
                        }
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

                        // Bidirectional linking
                        deps.add(currentComputing);
                        currentComputing[sources].add({ target, property: p, deps });
                    }

                    // https://jsbench.me/p6mjxatbz4/1 - without function cache is faster in all major browsers
                    // probably because of an extra unwrapValue required with cache and extra cache lookup
                    // Functions are wrapped to apply with correct `this` (target, not proxy)
                    // After function call, mark deps dirty (function may have mutated internal state)
                    return valueType === 'function'
                        ? /** @param {...any} args */ (...args) => {
                              const result = /** @type {Function} */ (propValue).apply(target, args.map(unwrapValue));
                              // Notify after function call (function may have mutated state)
                              // Only notify if we're NOT currently inside an effect/computed execution
                              // to avoid infinite loops when reading during effect
                              if (!currentComputing) {
                                  const propsMap = propertyDeps.get(target);
                                  if (propsMap) {
                                      for (const [, deps] of propsMap) {
                                          const depsArray = [...deps];
                                          for (const dep of depsArray) {
                                              deps.delete(dep);
                                              markDirty(dep);
                                          }
                                      }
                                  }
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
                        // Notify dependents of this specific property
                        const propsMap = propertyDeps.get(target);
                        if (propsMap) {
                            const deps = propsMap.get(property);
                            if (deps) {
                                const depsArray = [...deps];
                                for (const dep of depsArray) {
                                    deps.delete(dep);
                                    markDirty(dep);
                                }
                            }
                        }
                    }
                    return result;
                },
                deleteProperty(target, p) {
                    const result = Reflect.deleteProperty(target, p);
                    if (result) {
                        // Notify dependents of this specific property
                        const propsMap = propertyDeps.get(target);
                        if (propsMap) {
                            const deps = propsMap.get(p);
                            if (deps) {
                                const depsArray = [...deps];
                                for (const dep of depsArray) {
                                    deps.delete(dep);
                                    markDirty(dep);
                                }
                            }
                        }
                    }
                    return result;
                },
            });
            proxiesCache.set(object, proxy);
            return /** @type {T} */ (proxy);
        }
    };

    return createProxy(object);
};

/**
 * Creates a reactive effect that re-runs when its dependencies change
 * @param {() => void | (() => void)} callback - Effect function, can return cleanup
 * @returns {() => void} Dispose function
 */
export const effect = callback => {
    /** @type {EffectNode} */
    const fx = {
        [sources]: new Set(),
        [dirty]: false,
        [cleanup]: null,
        [isEffect]: true,
        [fn]: () => {},
    };

    fx[fn] = () => {
        // Run cleanup from previous execution
        if (typeof fx[cleanup] === 'function') fx[cleanup]();

        // Clear old dependencies
        clearSources(fx);

        // Track new dependencies
        const prev = currentComputing;
        currentComputing = fx;
        try {
            const result = callback();
            fx[cleanup] = result === undefined ? null : result;
        } finally {
            currentComputing = prev;
        }
    };

    // Mark dirty to trigger first run on next microtask
    markDirty(fx);

    // Return dispose function
    return () => {
        if (typeof fx[cleanup] === 'function') fx[cleanup]();
        clearSources(fx);
        // Remove from batched if scheduled
        batched.delete(fx);
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
    /** @type {ComputedNode<T> & { get value(): T }} */
    const comp = {
        [sources]: new Set(),
        [dependencies]: new Set(),
        [dirty]: true,
        [value]: /** @type {T} */ (/** @type {unknown} */ (undefined)),
        [fn]: getter,
        [isEffect]: false,

        get value() {
            // Track if someone is reading us
            if (tracked && currentComputing) {
                this[dependencies].add(currentComputing);
                currentComputing[sources].add({ computed: this });
            }

            // Circular dependency detection - check before dirty flag
            if (computingStack.has(this)) {
                throw new Error('Circular computed dependency detected');
            }

            // Recompute if dirty
            if (this[dirty]) {
                this[dirty] = false;
                clearSources(this);

                const prev = currentComputing;
                const prevTracked = tracked;
                currentComputing = this;
                tracked = true; // Computed always tracks its own dependencies
                computingStack.add(this);
                try {
                    this[value] = this[fn]();
                } catch (e) {
                    // Restore dirty flag on error so it can be retried
                    this[dirty] = true;
                    throw e;
                } finally {
                    currentComputing = prev;
                    tracked = prevTracked;
                    computingStack.delete(this);
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
