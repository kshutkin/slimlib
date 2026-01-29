<<<<<<< Updated upstream:store/src/state.ts
import { currentComputing, markDependents, trackStateDependency, tracked, unwrapValue } from './core';
import { warnIfWriteInComputed } from './debug';
import { propertyDepsSymbol, unwrap } from './symbols';
import type { DepsSet, ReactiveNode } from './internal-types';
=======
<<<<<<< Updated upstream:store/src/state.js
import { currentComputing, tracked } from './computed.js';
import { markDependents, trackDependency, unwrapValue } from './core.js';
import { warnIfWriteInComputed } from './debug.js';
import { propertyDepsSymbol, unwrap } from './symbols.js';

/**
 * @template T
 * @typedef {import('./index.js').Computed<T>} Computed
 */
=======
import { currentComputing, markDependents, trackStateDependency, tracked, unwrapValue } from './core';
import { warnIfWriteInComputed } from './debug';
import { propertyDepsSymbol, unwrap } from './symbols';
import type { Subscribable } from './internal-types';
>>>>>>> Stashed changes:store/src/state.ts
>>>>>>> Stashed changes:store/src/state.js

/**
 * Creates a store without an initial object
 */
export function state(): object;
/**
 * Creates a store with an initial object
 */
export function state<T extends object>(object: T): T;
/**
 * Creates a reactive state object
 */
export function state<T extends object>(object: T = {} as T): T {
    // State uses a proxy to intercept reads and writes
    // - Reads trigger PULL phase (trackDependency registers the consumer)
    // - Writes trigger PUSH phase (markDependents propagates dirty flags)
    const proxiesCache = new WeakMap();

    /**
     * PUSH PHASE: Notify all dependents that a property changed
     * This propagates dirty/check flags to all live consumers
     */
<<<<<<< Updated upstream:store/src/state.ts
    const notifyPropertyDependents = (target: object, property: string | symbol): void => {
        const propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, DepsSet<ReactiveNode>> | undefined;
=======
<<<<<<< Updated upstream:store/src/state.js
    const notifyPropertyDependents = (target, property) => {
        const propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
            /** @type {any} */ (target)[propertyDepsSymbol]
        );
=======
    const notifyPropertyDependents = (target: object, property: string | symbol): void => {
        const propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, Subscribable> | undefined;
>>>>>>> Stashed changes:store/src/state.ts
>>>>>>> Stashed changes:store/src/state.js
        if (!propsMap) return;
        const deps = propsMap.get(property);
        if (deps) {
            markDependents(deps as DepsSet<ReactiveNode>);
        }
    };

    const createProxy = <U extends object>(object: U): U => {
        if (proxiesCache.has(object)) {
            return proxiesCache.get(object) as U;
        }

        const methodCache = new Map<string | symbol, (...args: unknown[]) => unknown>();

        const proxy = new Proxy(object, {
            // PUSH PHASE: Setting a property notifies all dependents
            set(target, p, newValue) {
                warnIfWriteInComputed('state');
                const realValue = unwrapValue(newValue);
                // Use direct property access instead of Reflect for performance
                if (!Object.is((target as Record<string | symbol, unknown>)[p], realValue)) {
                    (target as Record<string | symbol, unknown>)[p] = realValue;
                    // PUSH: Propagate dirty flags to dependents
                    notifyPropertyDependents(target, p);
                    // Clear method cache entry if it was a method
                    methodCache.delete(p);
                }
                return true;
            },
            // PULL PHASE: Reading a property registers the dependency
            get(target, p) {
                if (p === unwrap) return target;
                // Use direct property access instead of Reflect for performance
                const propValue = (target as Record<string | symbol, unknown>)[p];

                // PULL: Track dependency if we're inside an effect/computed
                if (tracked && currentComputing) {
                    // Get or create the Map for this target (stored as non-enumerable property)
<<<<<<< Updated upstream:store/src/state.ts
                    let propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, DepsSet<ReactiveNode>> | undefined;
=======
<<<<<<< Updated upstream:store/src/state.js
                    let propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
                        /** @type {any} */ (target)[propertyDepsSymbol]
                    );
=======
                    let propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, Subscribable> | undefined;
>>>>>>> Stashed changes:store/src/state.ts
>>>>>>> Stashed changes:store/src/state.js
                    if (!propsMap) {
                        propsMap = new Map();
                        Object.defineProperty(target, propertyDepsSymbol, { value: propsMap });
                    }

                    // Get or create the Subscribable for this property
                    let deps = propsMap.get(p);

                    if (!deps) {
<<<<<<< Updated upstream:store/src/state.js
                        // biome-ignore lint/suspicious/noAssignInExpressions: optimization
                        propsMap.set(p, (deps = new Set() as DepsSet<ReactiveNode>));
                    }

<<<<<<< Updated upstream:store/src/state.ts
                    // PULL: Bidirectional linking with optimization
                    // Pass value getter for polling optimization (value revert detection)
                    // Capture target and property for later value retrieval
                    trackStateDependency(deps as DepsSet<ReactiveNode>, () => (target as Record<string | symbol, unknown>)[p], propValue);
=======
                    // Bidirectional linking with optimization
                    trackDependency(deps);
=======
                        deps = {
                            $_subs: undefined,
                            $_subsTail: undefined,
                            $_version: 0,
                        };
                        propsMap.set(p, deps);
                    }

                    // PULL: Bidirectional linking with optimization
                    // Pass value getter for polling optimization (value revert detection)
                    // Capture target and property for later value retrieval
                    trackStateDependency(deps, () => (target as Record<string | symbol, unknown>)[p], propValue);
>>>>>>> Stashed changes:store/src/state.ts
>>>>>>> Stashed changes:store/src/state.js
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
                        // Capture method reference at cache time to avoid re-reading on each call
                        const method = propValue as (...args: unknown[]) => unknown;
                        cached = (...args: unknown[]) => {
                            // Unwrap in-place - args is already a new array from rest params
                            for (let i = 0; i < args.length; ++i) {
                                args[i] = unwrapValue(args[i]);
                            }
                            const result = method.apply(target, args);
                            // PUSH PHASE: Notify after function call (function may have mutated state)
                            // Only notify if we're NOT currently inside an effect/computed execution
                            // to avoid infinite loops when reading during effect
                            if (!currentComputing) {
<<<<<<< Updated upstream:store/src/state.ts
                                const propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, DepsSet<ReactiveNode>> | undefined;
=======
<<<<<<< Updated upstream:store/src/state.js
                                const propsMap = /** @type {Map<string | symbol, Set<Computed<any>>> | undefined} */ (
                                    /** @type {any} */ (target)[propertyDepsSymbol]
                                );
=======
                                const propsMap = (target as Record<symbol, unknown>)[propertyDepsSymbol] as Map<string | symbol, Subscribable> | undefined;
>>>>>>> Stashed changes:store/src/state.ts
>>>>>>> Stashed changes:store/src/state.js
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
                return createProxy(propValue as object);
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
        return proxy as U;
    };

    return createProxy(object);
}