/**
 * @template T
 * @callback StoreCallback
 * @param {T} value
 * @returns {void}
 */

/**
 * @callback UnsubscribeCallback
 * @returns {void}
 */

/**
 * @template T
 * @typedef {Object} StoreFunction
 * @property {(cb: StoreCallback<T>) => UnsubscribeCallback} subscribe - Subscribe to store changes
 * @property {() => Readonly<T>} get - Get current store value
 */

/**
 * @template T
 * @typedef {((cb: StoreCallback<T>) => UnsubscribeCallback) & (() => Readonly<T>)} Store
 */

const unwrap = Symbol();

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
export const unwrapValue = (value) => (value != null && /** @type {Unwrappable<T>} */(value)[unwrap]) || value;

/**
 * Creates a store factory function
 * @returns {<T extends object>(object?: T) => [T, Store<T>, () => void]}
 */
export const createStoreFactory = () => {
    return (object = /** @type {any} */({})) => {
        let willNotifyNextTick = false;
        const proxiesCache = new WeakMap();
        const storeListeners = new Set();

        const enqueueNotification = () => {
            if (!willNotifyNextTick) {
                willNotifyNextTick = true;
                queueMicrotask(() => {
                    willNotifyNextTick = false;
                    for (const listener of storeListeners) {
                        listener(object);
                    }
                });
            }
        };

        /**
         * @template {object} T
         * @param {T} object
         * @returns {T}
         */
        const createProxy = (object) => {
            if (proxiesCache.has(object)) {
                return /** @type {T} */(proxiesCache.get(object));
            } else {
                const proxy = new Proxy(object, {
                    set(target, p, value, receiver) {
                        const realValue = unwrapValue(value);
                        if (Reflect.get(target, p, receiver) !== realValue) {
                            Reflect.set(target, p, realValue, receiver);
                            enqueueNotification();
                        }
                        return true;
                    },
                    get(target, p) {
                        if (p === unwrap) return target;
                        const value = Reflect.get(target, p);
                        const valueType = typeof value;
                        // https://jsbench.me/p6mjxatbz4/1 - without function cache is faster in all major browsers
                        // probably because of an extra unwrapValue required with cache and extra cache lookup
                        return valueType === 'function' ? (/** @param {...any} args */(...args) => {
                            enqueueNotification();
                            return /** @type {Function} */(value).apply(target, args.map(unwrapValue));
                        }) : (value !== null && valueType === 'object' ? createProxy(/** @type {any} */(value)) : value);
                    },
                    defineProperty(...args) {
                        enqueueNotification();
                        return Reflect.defineProperty(...args);
                    },
                    deleteProperty(target, p) {
                        const result = Reflect.deleteProperty(target, p);
                        if (result) {
                            enqueueNotification();
                        }
                        return result;
                    }
                });
                proxiesCache.set(object, proxy);
                return /** @type {T} */(proxy);
            }
        };

        const proxy = createProxy(object);

        return [
            proxy,
            /** @type {Store<any>} */((cb) => {
                if (!cb) {
                    return object;
                }
                storeListeners.add(cb);
                return () => storeListeners.delete(cb);
            }),
            enqueueNotification
        ];
    };
};
