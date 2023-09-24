# Store

Proxy-based store for SPAs.

1. Simple
2. Relatively fast
3. Small size (less than 1Kb minified not gzipped)
4. Typescript support

[Changelog](./CHANGELOG.md)

# Installation

Using npm:
```
npm install --save-dev @slimlib/store
```

# Usage

### React

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

### Preact

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

### Svelte

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

### Angular

In store

```javascript
import { SlimlibStore } from '@slimlib/store/angular';

// create store
@Injectable()
export class StoreName extends SlimlibStore<State> {
    constructor() {
        super(/*Initial state*/{ field: 123 }});
    }

    // selectors
    field = this.select(state => state.field);

    // actions
    doSomething() {
        this.state.field = value;
    }
}
```

### rxjs

```javascript
import { createStore, toObservable } from '@slimlib/store/rxjs';

// create store
const [state, store] = createStore();

// action
export function doSomething() {
    state.field = value;
}

// observable
export const state$ = toObservable(store);
```

## API

### `main` and `core` exports

####  `createStoreFactory(notifyAfterCreation: boolean)`

Returns createStore factory (see next) which notifies immediately after creating store if `notifyAfterCreation` is truthy.

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory function that takes initial state and returns proxy object, store and function to notify subscribers. Proxy object meant to be left for actions implementations, store is for subscription for changes and notification only for some edge cases when an original object has been changed and listeners have to be notified.

#### `unwrapValue(value: T): T`

Unwraps a potential proxy object and returns a plain object if possible or value itself.

#### `Store<T>`

```typescript
type StoreCallback<T> = (value: T) => void;
type UnsubscribeCallback = () => void;
interface Store<T> {
    (cb: StoreCallback<T>): UnsubscribeCallback;
    (): T;
}
```

Publish/subscribe/read pattern implementation. Meant to be used in components / services that want to subscribe for store changes.

### `react` and `preact` exports

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `false`.

### `useStore<T>(store: Store<T>): Readonly<T>`

Function to subscribe to store inside component. Returns current state.

### `svelte` export

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `true`.

### `angular` export

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `false`.

#### `toSignal<T>(store: Store<T>): Signal<T>` - converts store to signal

#### `SlimlibStore`

Base class for store services.

##### `constructor(initialState: T)` - creates store with initial state

##### `state: T` - store state (proxy object)
##### `select<R>(...signals: Signal[], projector: (state: T, ...signalValue: SignalValue<signals[index]>) => R): Signal<R>` - selector function that returns a signal

### `rxjs` export

#### `createStore<T>(initialState: T): [T, Store<T>, () => void]`

Store factory created with `notifyAfterCreation` === `false`.

#### `toObservable<T>(store: Store<T>): Observable<T>` - converts store to observable

## Limitations

`Map`, `Set`, `WeakMap`, `WeakSet` cannot be used as values in current implementation.

Mixing proxied values and values from an underlying object can fail for cases where code needs checking for equality.

For example searching for an array element from the underlying object in a proxied array will fail.

## Similar projects

[Valtio](https://github.com/pmndrs/valtio) - more sophisticated but similar approach, less limitations

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
