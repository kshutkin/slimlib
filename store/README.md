# Store

Proxy-based store for SPAs.

# Installation

Using npm:
```
npm install --save-dev @slimlib/store
```

# Usage

React:

```javascript
import { createStore, useStore } from '@slimlib/store/react';

// create store
const [state, store] = createStore();

// action
function doSomething() {
    state.field = value;
}

//component
function Component() {
    const state = useStore(store);
    
    // use state
}
```

Preact:

```javascript
import { createStore, useStore } from '@slimlib/store/preact';

// create store
const [state, store] = createStore();

// action
function doSomething() {
    state.field = value;
}

//component
function Component() {
    const state = useStore(store);
    
    // use state
}
```

Svelte:

In store

```javascript
import { createStore, useStore } from '@slimlib/store/svelte';

// create store
const [state, store] = createStore();

// action
function doSomething() {
    state.field = value;
}

export const storeName = {
    subscribe: store
};
```

In component

```svelte
<script>
import { storeName } from './stores/storeName';
</script>

// use it in reactive way for reading data
$storeName
```

## API (main export)

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

Mixing proxied values and values from underlying object can fail for cases where code needs checking for equality.

For example searching array element from underlying object in proxified array will fail.
# License

[MIT](./LICENSE)
