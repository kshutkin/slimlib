import { markDependents, trackDependency, unwrapValue } from './core.js';
import { warnIfWriteInComputed } from './debug.js';
import { currentComputing, tracked } from './globals.js';
import { propertyDepsSymbol, subs, subsTail, unwrap } from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */

/**
 * @typedef {import('./core.js').SignalNode} SignalNode
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
        const propsMap = /** @type {Map<string | symbol, SignalNode> | undefined} */ (/** @type {any} */ (target)[propertyDepsSymbol]);
        if (!propsMap) return;
        // If property specified, notify just that property; otherwise notify all
        if (property !== undefined) {
            const node = propsMap.get(property);
            if (node) {
                markDependents(node);
            }
        } else {
            for (const node of propsMap.values()) {
                markDependents(node);
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
                    let propsMap = /** @type {Map<string | symbol, SignalNode> | undefined} */ (
                        /** @type {any} */ (target)[propertyDepsSymbol]
                    );
                    if (!propsMap) {
                        propsMap = new Map();
                        Object.defineProperty(target, propertyDepsSymbol, { value: propsMap });
                    }

                    // Get or create the node for this property
                    let node = propsMap.get(p);

                    if (!node) {
                        // Create a new SignalNode for this property
                        node = {
                            [subs]: undefined,
                            [subsTail]: undefined,
                        };
                        propsMap.set(p, node);
                    }

                    // Bidirectional linking with optimization
                    trackDependency(node);
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
                            // Unwrap in-place - args is already a new array from rest params
                            for (let i = 0; i < args.length; ++i) {
                                args[i] = unwrapValue(args[i]);
                            }
                            const result = method.apply(target, args);
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
