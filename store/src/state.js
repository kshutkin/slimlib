import { currentComputing, markDependents, trackDependency, tracked, unwrapValue } from './core.js';
import { warnIfWriteInComputed } from './debug.js';
import { propertyDepsSymbol, unwrap } from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */

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
 * @template {object} T
 * @param {T} [object] - Optional object to make reactive
 * @returns {T}
 */
export function state(object = /** @type {T} */ ({})) {
    // State uses a proxy to intercept reads and writes
    // - Reads trigger PULL phase (trackDependency registers the consumer)
    // - Writes trigger PUSH phase (markDependents propagates dirty flags)
    const proxiesCache = new WeakMap();

    /**
     * PUSH PHASE: Notify all dependents that a property changed
     * This propagates dirty/check flags to all live consumers
     * @param {object} target
     * @param {string | symbol} property
     */
    const notifyPropertyDependents = (target, property) => {
        const propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
            /** @type {any} */ (target)[propertyDepsSymbol]
        );
        if (!propsMap) return;
        const deps = propsMap.get(property);
        if (deps) {
            markDependents(deps);
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

        /** @type {Map<string | symbol, Function>} */
        const methodCache = new Map();

        const proxy = new Proxy(object, {
            // PUSH PHASE: Setting a property notifies all dependents
            set(target, p, newValue) {
                warnIfWriteInComputed('state');
                const realValue = unwrapValue(newValue);
                // Use direct property access instead of Reflect for performance
                if (!Object.is(/** @type {Record<string | symbol, any>} */ (target)[p], realValue)) {
                    /** @type {Record<string | symbol, any>} */ (target)[p] = realValue;
                    // PUSH: Propagate dirty flags to dependents
                    notifyPropertyDependents(target, p);
                }
                return true;
            },
            // PULL PHASE: Reading a property registers the dependency
            get(target, p) {
                if (p === unwrap) return target;
                // Use direct property access instead of Reflect for performance
                const propValue = /** @type {Record<string | symbol, any>} */ (target)[p];

                // PULL: Track dependency if we're inside an effect/computed
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

                    // PULL: Bidirectional linking with optimization
                    // Pass value getter for polling optimization (value revert detection)
                    // Capture target and property for later value retrieval
                    trackDependency(deps, undefined, () => /** @type {Record<string | symbol, any>} */ (target)[p]);
                }

                // Fast path for primitives (most common case)
                const propertyType = typeof propValue;
                if (propValue === null || (propertyType !== 'object' && propertyType !== 'function')) {
                    return propValue;
                }

                // Functions are wrapped to apply with correct `this` (target, not proxy)
                // After function call, notify dependents (function may have mutated internal state)
                // Functions are wrapped to trigger PUSH after mutation
                if (propertyType === 'function') {
                    // Check cache first to avoid creating new function on every access
                    let cached = methodCache.get(p);
                    if (!cached) {
                        cached = /** @param {...any} args */ (...args) => {
                            // Re-read the method in case it changed
                            const method = /** @type {Function} */ (/** @type {Record<string | symbol, any>} */ (target)[p]);
                            // Unwrap in-place - args is already a new array from rest params
                            for (let i = 0; i < args.length; ++i) {
                                args[i] = unwrapValue(args[i]);
                            }
                            const result = method.apply(target, args);
                            // PUSH PHASE: Notify after function call (function may have mutated state)
                            // Only notify if we're NOT currently inside an effect/computed execution
                            // to avoid infinite loops when reading during effect
                            if (!currentComputing) {
                                const propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
                                    /** @type {any} */ (target)[propertyDepsSymbol]
                                );
                                if (!propsMap) return result;
                                for (const deps of propsMap.values()) {
                                    // PUSH: Propagate dirty flags to all property dependents
                                    markDependents(deps);
                                }
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
            // PUSH PHASE: Defining a property notifies dependents
            defineProperty(target, property, attributes) {
                warnIfWriteInComputed('state');
                const result = Reflect.defineProperty(target, property, attributes);
                if (result) {
                    // PUSH: Propagate dirty flags to dependents
                    notifyPropertyDependents(target, property);
                }
                return result;
            },
            // PUSH PHASE: Deleting a property notifies dependents
            deleteProperty(target, p) {
                warnIfWriteInComputed('state');
                const result = Reflect.deleteProperty(target, p);
                if (result) {
                    // PUSH: Propagate dirty flags to dependents
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
