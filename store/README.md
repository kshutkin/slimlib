# Store

Proxy-based store for SPAs.

# Installation

Using npm:
```
npm install --save-dev @slimlib/store
```

# Usage

TBD

## API

###  `createStoreFactory(notifyAfterCreation: boolean)`

The only exported function. It returns createStore factory (see next).

### `createStore<T>(initialState: T): [T, Store<T>]`

Store factory function that takes initial state and returns proxy object and store tuple. Proxy object ment to be left for actions implementations and store is for subscription for changes.

### `Store<T>`

```typescript
type StoreCallback<T> = (value: T) => void;
type UnsubscribeCallback = () => void;
interface Store<T> {
    (cb: StoreCallback<T>): UnsubscribeCallback;
    (): T;
}
```

Publish/subscribe/read pattern implementation. Ment to be used in components / services that want to subscribe for store changes.

## Limitations

`Map`, `Set`, `WeakMap`, `WeakSet` cannot be used as values in current implementation.

# License

[MIT](./LICENSE)