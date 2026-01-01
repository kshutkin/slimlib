export type StoreCallback<T> = (value: T) => void;
export type UnsubscribeCallback = () => void;

export interface Store<T> {
    (cb: StoreCallback<T>): UnsubscribeCallback;
    (): Readonly<T>;
}

const unwrap = Symbol();

type Unwrappable<T> = {
    [unwrap]: T;
} & T;

export const unwrapValue = <T>(value: T) => (value != null && (value as Unwrappable<T>)[unwrap]) || value;

export const createStoreFactory = (notifyAfterCreation: boolean) => {
    return <T extends object>(object: T = {} as T): [T, Store<T>, () => void] => {
        let willNotifyNextTick = false;
        const proxiesCache = new WeakMap<T, T>();
        const storeListeners = new Set<StoreCallback<T>>();
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
        const handler: ProxyHandler<T> = {
            set(target: T, p: string | symbol, value: unknown, receiver: unknown) {
                const realValue = unwrapValue(value);
                if (Reflect.get(target, p, receiver) !== realValue) {
                    Reflect.set(target, p, realValue, receiver);
                    enqueueNotification();
                }
                return true;
            },
            get(target: T, p: string | symbol, receiver: unknown) {
                if (p === unwrap) return target;
                const value = Reflect.get(target, p, receiver);
                const valueType = typeof value;
                // TODO maybe cache the wrapper function
                // TODO check if arrow function is fine here
                return valueType === 'function' ? (...args: unknown[]) => {
                    enqueueNotification();
                    // eslint-disable-next-line @typescript-eslint/ban-types
                    return (value as Function).apply(target, args.map(unwrapValue));
                } : (value !== null && valueType === 'object' ? createProxy(value as T) : value);
            },
            defineProperty(...args: [T, string | symbol, PropertyDescriptor]) {
                enqueueNotification();
                return Reflect.defineProperty(...args);
            },
            deleteProperty(target: T, p: string | symbol) {
                const result = Reflect.deleteProperty(target, p);
                if (result) {
                    enqueueNotification();
                }
                return result;
            }
        };
        const proxy = createProxy(object);
        return [
            proxy,
            ((cb?: StoreCallback<T>): UnsubscribeCallback | T => {
                if (!cb) {
                    return object;
                }
                storeListeners.add(cb);
                if (notifyAfterCreation) {
                    cb(object);
                }
                return () => storeListeners.delete(cb);
            }) as Store<T>,
            enqueueNotification
        ];
        function createProxy(object: T): T {
            if (proxiesCache.has(object)) {
                return proxiesCache.get(object) as T;
            } else {
                const proxy = new Proxy(object, handler);
                proxiesCache.set(object, proxy);
                return proxy;
            }
        }
    };
};
