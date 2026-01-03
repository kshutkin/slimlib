# Store

Proxy-based reactive store with signals-like API for SPAs.

1. Simple - automatic dependency tracking
2. Fast - fine-grained updates, only re-run what depends on changed values
3. Small - less than 1.3KB minified (core < 1KB)
4. TypeScript support

[Changelog](./CHANGELOG.md)

## Installation

```bash
npm install @slimlib/store
```

## Quick Start

```js
import { createStore, effect, computed } from "@slimlib/store";

// Create a reactive store
const store = createStore({ count: 0, name: "test" });

// Effects automatically track dependencies and re-run when they change
effect(() => {
  console.log("Count:", store.count);
});
// Logs: "Count: 0" (on next microtask)

// Computed values are lazy and cached
const doubled = computed(() => store.count * 2);

// Updates trigger effects automatically
store.count = 5;
// Logs: "Count: 5" (on next microtask)

console.log(doubled.value); // 10
```

## API

### `createStore<T>(object?: T): T`

Creates a reactive store from an object. Returns a proxy that tracks property access for dependency tracking.

```js
const store = createStore({ user: { name: "John" }, items: [] });

store.user.name = "Jane"; // Triggers effects that depend on user.name
store.items.push("item"); // Triggers effects that depend on items
```

### `effect(callback: () => void | (() => void)): () => void`

Creates a reactive effect that runs when its dependencies change. Returns a dispose function.

- Effects run on the next microtask (not synchronously)
- Multiple synchronous changes are automatically batched
- Callback can return a cleanup function

```js
const store = createStore({ count: 0 });

const dispose = effect(() => {
  console.log(store.count);

  // Optional: return cleanup function
  return () => {
    console.log("Cleaning up...");
  };
});

store.count = 1; // Effect runs after microtask

dispose(); // Stop the effect, run cleanup
```

### `computed<T>(getter: () => T): Computed<T>`

Creates a computed value that is lazily evaluated and cached until dependencies change.

```js
const store = createStore({ items: [1, 2, 3] });

const sum = computed(() => store.items.reduce((a, b) => a + b, 0));
const doubled = computed(() => sum.value * 2);

console.log(doubled.value); // 12

store.items.push(4);
console.log(doubled.value); // 20
```

### `untracked<T>(callback: () => T): T`

Execute a callback without tracking dependencies.

```js
const store = createStore({ a: 1, b: 2 });

effect(() => {
  console.log(store.a); // Tracked - effect re-runs when a changes

  const b = untracked(() => store.b); // Not tracked
  console.log(b);
});

store.b = 10; // Effect does NOT re-run
store.a = 5; // Effect re-runs
```

### `unwrapValue<T>(value: T): T`

Gets the underlying raw object from a proxy.

```js
const store = createStore({ data: { x: 1 } });
const raw = unwrapValue(store); // Returns the original object
```

## Features

### Automatic Batching

Multiple synchronous updates are automatically batched:

```js
const store = createStore({ a: 0, b: 0 });

let runs = 0;
effect(() => {
  store.a;
  store.b;
  runs++;
});

await flushPromises(); // runs = 1 (initial)

store.a = 1;
store.b = 2;
store.a = 3;

await flushPromises(); // runs = 2 (single batched update)
```

### Fine-Grained Tracking

Effects only re-run when their specific dependencies change:

```js
const store = createStore({ name: "John", age: 30 });

effect(() => console.log("Name:", store.name));
effect(() => console.log("Age:", store.age));

store.name = "Jane"; // Only first effect runs
store.age = 31; // Only second effect runs
```

### Conditional Dependencies

Dependencies are tracked dynamically based on execution path:

```js
const store = createStore({ flag: true, a: 1, b: 2 });

effect(() => {
  console.log(store.flag ? store.a : store.b);
});

store.b = 10; // Effect does NOT run (b not tracked when flag is true)
store.flag = false; // Effect runs, now tracks b instead of a
store.b = 20; // Effect runs
store.a = 5; // Effect does NOT run (a not tracked when flag is false)
```

### Diamond Problem Solved

Effects run only once even when multiple dependencies change:

```js
const store = createStore({ value: 1 });
const a = computed(() => store.value + 1);
const b = computed(() => store.value + 2);

let runs = 0;
effect(() => {
  a.value + b.value;
  runs++;
});

await flushPromises(); // runs = 1

store.value = 10;
await flushPromises(); // runs = 2 (not 3!)
```

## Migration from v1.x

v2.0 is a breaking change. Key differences:

| v1.x                                             | v2.x                            |
| ------------------------------------------------ | ------------------------------- |
| `const [proxy, store, notify] = createStore({})` | `const store = createStore({})` |
| `store(callback)` for subscription               | `effect(() => { ... })`         |
| `store()` to get raw value                       | `unwrapValue(store)`            |
| `notify()` for manual notification               | Automatic (no manual notify)    |

### Before (v1.x)

```js
const [state, store] = createStore({ count: 0 });
const unsubscribe = store((value) => console.log(value.count));
state.count = 1;
```

### After (v2.x)

```js
const store = createStore({ count: 0 });
const dispose = effect(() => console.log(store.count));
store.count = 1;
```

## Limitations

- Mixing proxied values and values from an underlying object can fail for equality checks
- Effects run on microtask, not synchronously

## Similar Projects

- [Solid.js Signals](https://www.solidjs.com/docs/latest/api#createsignal) - similar reactive primitives
- [Valtio](https://github.com/pmndrs/valtio) - proxy-based state management
- [@preact/signals](https://github.com/preactjs/signals) - signals for Preact

## License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
