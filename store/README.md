# Store

Reactive state management for SPAs with automatic dependency tracking.

## Why This Library

- **Minimal footprint** - tiny bundle size with zero dependencies
- **Automatic tracking** - no manual subscriptions, dependencies are tracked at runtime
- **Fine-grained updates** - only computeds/effects that depend on changed values re-run
- **Lazy computeds** - computed values are only calculated when read, not when dependencies change
- **Batched updates** - multiple synchronous changes trigger a single effect execution
- **Memory-safe** - uses WeakRef internally, unused computeds are garbage collected automatically
- **Dual usage** - computeds work both reactively (in effects) and imperatively (on-demand reads)
- **Proxy-based state** - mutate objects naturally, no setters or immutable updates required
- **TypeScript support** - full type inference

[Changelog](./CHANGELOG.md)

## Installation

```bash
npm install @slimlib/store
```

## Quick Start

```js
import { state, effect, computed } from "@slimlib/store";

// Create a reactive store
const store = state({ count: 0, name: "test" });

// Effects automatically track dependencies and re-run when they change
const dispose = effect(() => {
  console.log("Count:", store.count);
});
// Logs: "Count: 0" (on next microtask)

// Computed values are lazy and cached
const doubled = computed(() => store.count * 2);

// Updates trigger effects automatically
store.count = 5;
// Logs: "Count: 5" (on next microtask)

console.log(doubled()); // 10

// Stop the effect when done
dispose();
```

## API

### `state<T>(object?: T): T`

Creates a reactive store from an object. Returns a proxy that tracks property access for dependency tracking.

```js
const store = state({ user: { name: "John" }, items: [] });

store.user.name = "Jane"; // Triggers effects that depend on user.name
store.items.push("item"); // Triggers effects that depend on items
```

### `effect(callback: () => void | (() => void)): () => void`

Creates a reactive effect that runs when its dependencies change. Returns a dispose function.

- Effects run on the next microtask (not synchronously) by default
- Multiple synchronous changes are automatically batched
- Callback can return a cleanup function
- **Important**: If not created within a scope, you must hold a reference to the dispose function to prevent the effect from being garbage collected

```js
import { effect, state } from "@slimlib/store";

const store = state({ count: 0 });

// Hold the dispose function to prevent GC
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

For managing multiple effects, use a [scope](#scopecallback-parent-scope):

```js
import { scope, effect, state } from "@slimlib/store";

const store = state({ count: 0 });

const ctx = scope(() => {
  effect(() => console.log("Effect 1:", store.count));
  effect(() => console.log("Effect 2:", store.count));
});

ctx(); // Dispose all effects at once
```

### `computed<T>(getter: () => T): () => T`

Creates a computed value that is lazily evaluated and cached until dependencies change. Returns a function that retrieves the computed value.

```js
const store = state({ items: [1, 2, 3] });

const sum = computed(() => store.items.reduce((a, b) => a + b, 0));
const doubled = computed(() => sum() * 2);

console.log(doubled()); // 12

store.items.push(4);
console.log(doubled()); // 20
```

#### Reactive vs Imperative Usage

Computeds support two usage patterns:

**Reactive** - tracked by effects, automatically re-evaluated:

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log(doubled()); // Re-runs when count changes
});
```

**Imperative** - called directly from regular code on-demand:

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

// No effect needed - just read when you want
console.log(doubled()); // 0

count.set(5);
console.log(doubled()); // 10 - recomputes on demand
```

Both patterns can coexist. A computed stays connected to its sources as long as it's referenced, regardless of whether any effect tracks it. This allows computeds to be used as derived getters in imperative code while still participating in the reactive graph when needed.

### `signal<T>(initialValue?: T): (() => T) & { set: (value: T) => void }`

Creates a simple reactive signal. Returns a function to read the value with a `set` method to update it.

```js
import { signal, effect } from "@slimlib/store";

const count = signal(0);

effect(() => {
  console.log("Count:", count());
});

count.set(5); // Effect runs after microtask
console.log(count()); // 5
```

### `flushEffects(): void`

Immediately executes all pending effects without waiting for the next microtask. Useful for testing or when you need synchronous effect execution.

```js
const store = state({ count: 0 });

let runs = 0;
effect(() => {
  store.count;
  runs++;
});

flushEffects(); // runs = 1 (initial run)

store.count = 1;
store.count = 2;
flushEffects(); // runs = 2 (batched update executed immediately)
```

### `setScheduler(fn: (callback: () => void) => void): void`

Sets a custom scheduler function for effect execution. By default, effects are scheduled using `queueMicrotask`. You can replace it with any function that accepts a callback.

```js
import { setScheduler } from "@slimlib/store";

// Use setTimeout instead of queueMicrotask
setScheduler((callback) => setTimeout(callback, 0));

// Or use requestAnimationFrame for UI updates
setScheduler((callback) => requestAnimationFrame(callback));
```

### `scope(callback?, parent?): Scope`

Creates a reactive scope for tracking effects. Effects created within a scope are automatically tracked and disposed together when the scope is disposed. This is useful for managing component lifecycles or grouping related effects.

```js
import { scope, effect, state } from "@slimlib/store";

const store = state({ count: 0 });

// Create a scope with callback
const ctx = scope((onDispose) => {
  effect(() => console.log(store.count));

  // Register cleanup to run when scope is disposed
  onDispose(() => console.log("Scope disposed"));
});

// Extend the scope (add more effects)
ctx((onDispose) => {
  effect(() => console.log("Another effect:", store.count));
});

// Dispose all effects and run cleanup handlers
ctx();
```

**Parameters:**

- `callback` - Optional function receiving an `onDispose` callback for registering cleanup handlers
- `parent` - Optional parent scope (defaults to `activeScope`). Pass `undefined` for a detached scope with no parent.

**Returns:** A scope function (`ctx`) that:

- `ctx(callback)` - Runs callback in scope context, returns `ctx` for chaining
- `ctx()` - Disposes scope and all tracked effects, returns `undefined`

#### Hierarchical Scopes

Scopes can be nested. When a parent scope is disposed, all child scopes are also disposed:

```js
const outer = scope(() => {
  effect(() => console.log("Outer effect"));

  // Inner scope automatically becomes child of outer
  const inner = scope(() => {
    effect(() => console.log("Inner effect"));
  });
});

outer(); // Disposes both outer AND inner effects
```

Create a detached scope (no parent) by passing `undefined`:

```js
const detached = scope(() => {
  effect(() => console.log("Detached"));
}, undefined);
```

### `activeScope`

A live binding export that contains the currently active scope (or `undefined` if none).

```js
import { activeScope, scope } from "@slimlib/store";

console.log(activeScope); // undefined

scope(() => {
  console.log(activeScope); // the current scope
});

console.log(activeScope); // undefined
```

### `setActiveScope(scope?): void`

Sets or clears the global active scope. Effects created outside of a `scope()` callback will be tracked to the active scope.

```js
import { setActiveScope, scope, effect, state } from "@slimlib/store";

const store = state({ count: 0 });
const appScope = scope();

// Set as the default scope for all effects
setActiveScope(appScope);

// This effect is tracked to appScope
effect(() => console.log(store.count));

// Clear the active scope
setActiveScope(undefined);

// Dispose all effects
appScope();
```

This is useful for frameworks that want a single root scope for all effects created during component initialization.

### `debugConfig(flags: number): void`

Configure debug behavior using a bitfield of flags.

```js
import { debugConfig, WARN_ON_WRITE_IN_COMPUTED } from "@slimlib/store";

// Enable warnings when writing to signals/state inside a computed
debugConfig(WARN_ON_WRITE_IN_COMPUTED);

// Disable all debug flags
debugConfig(0);
```

#### `WARN_ON_WRITE_IN_COMPUTED`

When enabled, logs a warning to the console if you write to a signal or state inside a computed. This helps catch a common mistake where the computed will not re-run when the written value changes, potentially leading to stale values.

```js
import { debugConfig, WARN_ON_WRITE_IN_COMPUTED } from "@slimlib/store";

debugConfig(WARN_ON_WRITE_IN_COMPUTED);

const counter = signal(0);
const other = signal(0);

const doubled = computed(() => {
  other.set(counter() * 2); // ⚠️ Warning logged!
  return counter() * 2;
});
```

**Note**: This warning only appears in development mode (when `esm-env`'s `DEV` flag is true). In production builds, the warning code is completely eliminated via dead code elimination when bundlers replace the `DEV` constant with `false`.

For zero-cost production builds, configure your bundler to replace the `DEV` constant. With Vite/Rollup, this happens automatically based on the build mode.

#### `SUPPRESS_EFFECT_GC_WARNING`

By default in development mode, the library warns when an effect is garbage collected without being properly disposed. This helps detect memory leaks where effects are created but never cleaned up.

```js
// ⚠️ This will trigger a warning in dev mode:
(() => {
  const store = state({ count: 0 });
  effect(() => {
    console.log(store.count);
  });
  // dispose function is not stored or called!
})();
// When the scope exits, the effect's dispose function becomes unreachable
// and will be garbage collected, triggering a warning.
```

The warning includes a stack trace showing where the orphaned effect was created, making it easy to track down the issue.

To suppress this warning (e.g., in tests or when intentionally letting effects be GC'd), use the `SUPPRESS_EFFECT_GC_WARNING` flag:

```js
import { debugConfig, SUPPRESS_EFFECT_GC_WARNING } from "@slimlib/store";

// Suppress the GC warning
debugConfig(SUPPRESS_EFFECT_GC_WARNING);

// Combine with other flags
debugConfig(WARN_ON_WRITE_IN_COMPUTED | SUPPRESS_EFFECT_GC_WARNING);
```

**Best Practice**: Always properly dispose effects by either:

- Calling the returned dispose function
- Creating effects within a `scope()` that gets disposed
- Using `setActiveScope()` to track effects to a parent scope

**Note**: This warning uses `FinalizationRegistry` internally and only runs in development mode. The entire mechanism is eliminated in production builds.

#### `WARN_ON_UNTRACKED_EFFECT`

When enabled, warns when effects are created without an active scope. This is an allowed pattern, but teams may choose to enforce scope usage for better effect lifecycle management.

```js
import { debugConfig, WARN_ON_UNTRACKED_EFFECT } from "@slimlib/store";

debugConfig(WARN_ON_UNTRACKED_EFFECT);

// ⚠️ This will now trigger a warning:
const dispose = effect(() => {
  console.log("No active scope!");
});

// No warning when using a scope:
const ctx = scope(() => {
  effect(() => {
    console.log("Tracked by scope");
  });
});
```

This warning is disabled by default because creating effects without a scope is a valid pattern - developers simply need to manage the dispose function manually. However, teams that prefer all effects to be tracked by scopes can enable this warning to enforce that convention.

**Note**: This warning only runs in development mode and is completely eliminated in production builds.

### `untracked<T>(callback: () => T): T`

Execute a callback without tracking dependencies.

```js
const store = state({ a: 1, b: 2 });

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
const store = state({ data: { x: 1 } });
const raw = unwrapValue(store); // Returns the original object
```

## Features

### Automatic Batching

Multiple synchronous updates are automatically batched:

```js
const store = state({ a: 0, b: 0 });

let runs = 0;
effect(() => {
  store.a;
  store.b;
  runs++;
});

flushEffects(); // runs = 1 (initial)

store.a = 1;
store.b = 2;
store.a = 3;

flushEffects(); // runs = 2 (single batched update)
```

### Fine-Grained Tracking

Effects only re-run when their specific dependencies change:

```js
const store = state({ name: "John", age: 30 });

effect(() => console.log("Name:", store.name));
effect(() => console.log("Age:", store.age));

store.name = "Jane"; // Only first effect runs
store.age = 31; // Only second effect runs
```

### Conditional Dependencies

Dependencies are tracked dynamically based on execution path:

```js
const store = state({ flag: true, a: 1, b: 2 });

effect(() => {
  console.log(store.flag ? store.a : store.b);
});

store.b = 10; // Effect does NOT run (b not tracked when flag is true)
store.flag = false; // Effect runs, now tracks b instead of a
store.b = 20; // Effect runs
store.a = 5; // Effect does NOT run (a not tracked when flag is false)
```

### Error Handling in Computeds

This library follows the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) for error handling:

> Like Promises, Signals can represent an error state: If a computed Signal's callback throws, then that error is cached just like another value, and rethrown every time the Signal is read.

When a computed throws an error during evaluation, the error is **cached** and the computed is marked as clean. Subsequent reads will rethrow the cached error without re-executing the callback, until a dependency changes:

```js
const store = state({ value: -1 });
let callCount = 0;

const safeSqrt = computed(() => {
  callCount++;
  if (store.value < 0) {
    throw new Error("Cannot compute square root of negative number");
  }
  return Math.sqrt(store.value);
});

// First read throws
try {
  safeSqrt();
} catch (e) {
  console.log(e.message); // "Cannot compute square root of negative number"
}
console.log(callCount); // 1

// Second read rethrows the CACHED error (callback is NOT called again)
try {
  safeSqrt();
} catch (e) {
  console.log(e.message); // "Cannot compute square root of negative number"
}
console.log(callCount); // Still 1 - callback was not re-executed

// Fix the data - this marks the computed as needing re-evaluation
store.value = 4;

// Computed recovers automatically
console.log(safeSqrt()); // 2
console.log(callCount); // 3 - callback was called again
```

Key behaviors (per TC39 Signals proposal):

- Errors **are cached** - the computed will NOT retry on subsequent reads
- The cached error is rethrown on every read until a dependency changes
- When a dependency changes, the computed is marked for re-evaluation
- The computed remains connected to its dependencies even after an error
- Effects that read throwing computeds should handle errors appropriately

### Cycle Detection

This library follows the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) for cycle detection:

> It is an error to read a computed recursively.

When a computed signal attempts to read itself (directly or indirectly through other computeds), an error is thrown immediately:

```js
// Direct self-reference
const self = computed(() => self() + 1);
self(); // throws: "Detected cycle in computations."

// Indirect cycle through multiple computeds
const a = computed(() => b() + 1);
const b = computed(() => a() + 1);
a(); // throws: "Detected cycle in computations."
```

Key behaviors:

- Cycles are detected at runtime when the cycle is actually traversed
- The error is thrown immediately, not cached like regular computed errors
- Computeds can recover if their dependencies change to break the cycle:

```js
const store = state({ useCycle: true, value: 10 });

const a = computed(() => {
  if (store.useCycle) {
    return b() + 1; // Creates cycle when useCycle is true
  }
  return store.value;
});
const b = computed(() => a() + 1);

a(); // throws: "Detected cycle in computations."

store.useCycle = false; // Break the cycle
a(); // 10 - works now!
b(); // 11
```

### Diamond Problem Solved

Effects run only once even when multiple dependencies change:

```js
const store = state({ value: 1 });
const a = computed(() => store.value + 1);
const b = computed(() => store.value + 2);

let runs = 0;
effect(() => {
  a() + b();
  runs++;
});

flushEffects(); // runs = 1

store.value = 10;
flushEffects(); // runs = 2 (not 3!)
```

### Automatic Memory Management

Computeds use WeakRef internally for dependency tracking. When a computed is no longer referenced anywhere in your code, it becomes eligible for garbage collection. Dead references are cleaned up lazily during dependency notification. No manual disposal is needed for computeds (effects still require explicit disposal via the returned function).

## Migration from v1.x

v2.0 is a breaking change. Key differences:

| v1.x                                             | v2.x                         |
| ------------------------------------------------ | ---------------------------- |
| `const [proxy, store, notify] = createStore({})` | `const store = state({})`    |
| `store(callback)` for subscription               | `effect(() => { ... })`      |
| `store()` to get raw value                       | `unwrapValue(store)`         |
| `notify()` for manual notification               | Automatic (no manual notify) |

### Before (v1.x)

```js
const [state, store] = createStore({ count: 0 });
const unsubscribe = store((value) => console.log(value.count));
state.count = 1;
```

### After (v2.x)

```js
import { state, effect } from "@slimlib/store";

const store = state({ count: 0 });
const dispose = effect(() => console.log(store.count));
store.count = 1;
```

## TC39 Signals Proposal Compatibility

This library is designed with the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) in mind. Here's how it aligns with the proposal and where it differs:

### What's Implemented

| Feature                  | Status | Notes                                               |
| ------------------------ | ------ | --------------------------------------------------- |
| Lazy computed evaluation | ✅     | Computeds only evaluate when read                   |
| Glitch-free execution    | ✅     | No intermediate states exposed                      |
| Error caching            | ✅     | Errors cached and rethrown until dependency changes |
| Cycle detection          | ✅     | Throws `"Detected cycle in computations."`          |
| Custom equality          | ✅     | Via second argument to `computed()`                 |
| Untrack                  | ✅     | `untracked()` function                              |
| Automatic GC             | ✅     | WeakRef-based, no manual disposal for computeds     |

### Additional Features (Not in TC39)

| Feature          | Notes                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| `effect()`       | TC39 leaves effects to frameworks; we provide a built-in implementation |
| `state()`        | Proxy-based reactive stores for deep reactivity                         |
| `setScheduler()` | Custom effect scheduling                                                |
| `flushEffects()` | Synchronous effect execution                                            |

### What's Not Implemented

| Feature                         | Reason                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `Signal.subtle.Watcher`         | Effects are built-in; no need to expose low-level Watcher API |
| `watched`/`unwatched` callbacks | Not needed for current use cases                              |
| Introspection APIs              | `introspectSources`, `introspectSinks`, etc. not exposed      |
| Frozen state                    | See below                                                     |

### Frozen State Considerations

The TC39 Signals proposal includes a "frozen" state that prevents reading or writing signals during certain phases:

1. **During Watcher `notify` callbacks** - when a state change triggers notification
2. **During `watched`/`unwatched` callbacks** - when a signal becomes observed or stops being observed

This frozen state prevents several classes of bugs:

- **Glitches**: Reading signals during notification could expose inconsistent intermediate states
- **Infinite loops**: Writing signals during notification could trigger cascading notifications
- **Graph corruption**: Modifying the graph while it's being traversed

**This library's approach**: A frozen state is **not** implemented because:

1. **Effects are batched**: Effects run on microtask (not synchronously during `set()`), so the graph is always fully marked before any effect reads signals
2. **No exposed Watcher**: Without a low-level Watcher API, there's no way to write `notify` callbacks that could misuse synchronous access
3. **Simpler mental model**: The batched approach naturally prevents most issues that frozen state addresses

If you're building a framework on top of this library and need Watcher-like functionality with frozen state guarantees, consider:

- Using `untracked()` carefully when reading signals in notification-like contexts
- Scheduling work via `queueMicrotask` or `setScheduler` rather than executing immediately
- Being aware that writing to signals during computed evaluation is allowed but can lead to unexpected behavior

## Development Warnings

The library includes development-time warnings that help catch common mistakes. These warnings:

1. **Are DEV-only** - Only run when `esm-env`'s `DEV` flag is true
2. **Are tree-shakeable** - Completely eliminated in production builds

| Warning                      | Default     | Flag                                    |
| ---------------------------- | ----------- | --------------------------------------- |
| Effect GC'd without disposal | **Enabled** | `SUPPRESS_EFFECT_GC_WARNING` to disable |
| Writing in computed          | Disabled    | `WARN_ON_WRITE_IN_COMPUTED` to enable   |
| Effect without active scope  | Disabled    | `WARN_ON_UNTRACKED_EFFECT` to enable    |

### Configuring Warnings

```js
import {
  debugConfig,
  WARN_ON_WRITE_IN_COMPUTED,
  WARN_ON_UNTRACKED_EFFECT,
  SUPPRESS_EFFECT_GC_WARNING,
} from "@slimlib/store";

// Enable write-in-computed warnings
debugConfig(WARN_ON_WRITE_IN_COMPUTED);

// Warn when effects are created without a scope
debugConfig(WARN_ON_UNTRACKED_EFFECT);

// Suppress GC warnings (e.g., in tests)
debugConfig(SUPPRESS_EFFECT_GC_WARNING);

// Combine flags
debugConfig(
  WARN_ON_WRITE_IN_COMPUTED |
    WARN_ON_UNTRACKED_EFFECT |
    SUPPRESS_EFFECT_GC_WARNING
);

// Reset to defaults
debugConfig(0);
```

### Bundler Configuration

The warnings use `esm-env` for environment detection. Most bundlers handle this automatically:

- **Vite**: Works out of the box - uses `development` condition in dev, `production` in build
- **Rollup/Webpack**: Configure resolve conditions or use `@rollup/plugin-replace`

For truly zero-cost production builds (complete code elimination), ensure your bundler sets the appropriate conditions.

## Limitations

- Mixing proxied values and values from an underlying object can fail for equality checks
- Effects run on microtask by default, not synchronously (use `flushEffects()` for immediate execution)

## Similar Projects

- [Solid.js Signals](https://www.solidjs.com/docs/latest/api#createsignal) - similar reactive primitives
- [Valtio](https://github.com/pmndrs/valtio) - proxy-based state management
- [@preact/signals](https://github.com/preactjs/signals) - signals for Preact

## License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
