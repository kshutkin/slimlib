export type StoreCallback<T> = (value: T) => void;
export type UnsubscribeCallback = () => void;

export interface Store<T> {
    (cb: StoreCallback<T>): UnsubscribeCallback;
    (): T; // return bare object without Proxy, put into documentation not to change state through it
}

export const createStoreFactory = (notifyAfterCreation: boolean) => {
    return <T extends object>(object: T = {} as T): [T, Store<T>] => {
        let willNotifyNextTick = false;
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
        const createProxy = <O extends object>(object: O): O => {
            return new Proxy<O>(object, {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                set(target: O, p: string | symbol, value: any, receiver: any) {
                    if (Reflect.get(target, p, receiver) !== value) {
                        Reflect.set(target, p, value, receiver);
                        enqueueNotification();
                    }
                    return true;
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                get(target: O, p: string | symbol, receiver: any) {
                    const value = Reflect.get(target, p, receiver);
                    return value !== null && typeof value === 'object' && !(value instanceof RegExp) ? createProxy(value) : value;
                },
                defineProperty(...args: [O, string | symbol, PropertyDescriptor]) {
                    enqueueNotification();
                    return Reflect.defineProperty(...args);
                },
                deleteProperty(target: O, p: string | symbol) {
                    const result = Reflect.deleteProperty(target, p);
                    if (result) {
                        enqueueNotification();
                    }
                    return result;
                }
            });
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
            }) as Store<T>
        ];
    };
};