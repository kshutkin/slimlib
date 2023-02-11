# Store

Proxy-based store for SPAs.

1. Simple
2. Relatively fast
3. Small size (less than 1Kb minified not gzipped)
4. Typescript support

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
const [state, subscribe] = createStore();

// action
export function doSomething() {
    state.field = value;
}

export default { subscribe };
```

In component

```svelte
<script>
import { storeName } from './stores/storeName';
</script>

// use it in reactive way for reading data
$storeName
```

## API

### `main` and `core` exports

####  `createStoreFactory(notifyAfterCreation: boolean)`

The only exported function. It returns createStore factory (see next) which notifies innidiately after creating store if `notifyAfterCreation` is truethy.

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory function that takes initial state and returns proxy object, store and function to notify subscribers. Proxy object ment to be left for actions implementations, store is for subscription for changes and notification only for some edge cases when original object have been changed and listeners have to be notified.

#### `unwrapValue(value: T): T`

Unwraps potential proxy object and returns plain object if possible or value itself.

#### `Store<T>`

```typescript
type StoreCallback<T> = (value: T) => void;
type UnsubscribeCallback = () => void;
interface Store<T> {
    (cb: StoreCallback<T>): UnsubscribeCallback;
    (): T;
}
```

Publish/subscribe/read pattern implementation. Ment to be used in components / services that want to subscribe for store changes.

### `react` and `preact` exports

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `false`.

### `useStore<T>(store: Store<T>): Readonly<T>`

Function to subscribe to store inside component. Returns current state.

### `svelte` export

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `true`.

## Limitations

`Map`, `Set`, `WeakMap`, `WeakSet` cannot be used as values in current implementation.

Mixing proxied values and values from underlying object can fail for cases where code needs checking for equality.

For example searching array element from underlying object in proxified array will fail.

## Similar projects

[Valtio](https://github.com/pmndrs/valtio) - more sofisticated but similar approach, less limitations

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
