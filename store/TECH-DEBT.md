# Technical debt

## Effect garbage collection and the documented lifetime contract

Status: lifetime contract and scope retention deferred; eager setup rollback fixed.

The README says that an effect created outside a scope needs its disposer to be retained to prevent garbage collection. The current implementation does not provide that behavior: a reachable reactive source strongly retains its subscribed effects, even when their disposers are no longer referenced.

### Current behavior

In [src/core.ts](./src/core.ts), `DepsSet` extends an ordinary `Set`, and dependency tracking adds effect nodes directly to it. For a signal, the reference chain is:

```text
reachable signal -> dependency Set -> effect node -> callback
```

Dropping the disposer does not break this chain. Calling it removes the subscriptions through `clearSources`. Disposing an owning scope also disposes its effects.

An entire unreachable signal/effect graph can still be collected; cyclic references alone do not prevent GC. The mismatch concerns effects subscribed to sources that remain reachable. Computeds have separate liveness tracking, so this observation should not be generalized to every reactive primitive.

A forced-GC probe confirmed that normal effect callbacks remain alive while their signal remains reachable. Before the eager setup rollback below was implemented, failed eager-effect callbacks were retained in the same way. A callback in an entirely unreachable signal/effect graph was collected. The development `FinalizationRegistry` warning is diagnostic; it does not unsubscribe effects.

### Eager setup throws before returning a disposer (resolved)

In [src/effect.ts](./src/effect.ts), the initial eager `runner()` call now disposes the effect before rethrowing the original error. This removes subscriptions, unregisters development GC tracking, and prevents an already queued effect from running. Errors during later runs retain their existing recovery behavior.

```js
import { effect, EffectOptions, flushEffects, signal } from '@slimlib/store';

const value = signal(0);
let runs = 0;
let dispose;

try {
    dispose = effect(() => {
        runs++;
        if (value() === 0) throw new Error('Setup failed');
    }, EffectOptions.EAGER);
} catch {
    // effect() disposed the failed effect before rethrowing.
}

value.set(1);
flushEffects();
// runs === 1; the failed effect stays stopped, although dispose is undefined.
```

Regression coverage in [tests/eager-failure.spec.mjs](./tests/eager-failure.spec.mjs) checks shared signal/state/computed sources, scoped and unscoped effects, microtask and synchronous schedulers, queued execution, original thrown values, and recovery after later-run errors.

### Remaining scope retention

Scope registration is unchanged. An owning scope still retains the failed effect's disposer, and therefore its callback and captured objects, until the scope is disposed or becomes unreachable. Manually disposed effects have the same retention behavior. Removing subscriptions stops further runs but does not immediately release these scope-held references.

### Workaround

Explicitly dispose effects, either through their returned disposers or an owning scope. Retaining a disposer is useful for teardown, but dropping it is not a way to stop the effect. Eager setup failures unsubscribe automatically. Scope disposal also releases registrations for already disposed effects.

### Resolution and validation

- Decide whether to restore the documented collection behavior for unowned effects or revise the public lifetime contract and README examples to require explicit teardown while sources remain reachable. A change to dependency ownership needs size and performance measurements.
- Consider unlinking disposed effects from owning scopes without adding an allocation per registration. Compare size and performance before changing scope storage.
- Add GC regressions with a reachable source and a dropped disposer, an unreachable whole graph, and effects kept alive by a disposer or scope. Existing computed GC coverage does not establish the effect lifetime contract.

## Object accessors bypass reactive input tracking

Status: deferred; implementation unchanged. Review finding #3.

In [src/state.ts](./src/state.ts), the proxy's `get` trap reads `target[property]` directly. Accessor getters therefore receive the raw target as `this`. Reads through `this` inside the getter bypass the proxy and do not register dependencies on those properties.

### Scenario

```js
import { effect, EffectOptions, flushEffects, state } from '@slimlib/store';

const model = state({
    a: 1,
    get doubled() {
        return this.a * 2;
    },
});
let observed;
const dispose = effect(() => {
    observed = model.doubled;
}, EffectOptions.EAGER);

model.a = 2;
flushEffects();
// observed remains 2; expected 4.
dispose();
```

The effect tracks `doubled`, but not `a`. Writing `a` does not notify dependents of `doubled`, so the effect stays stale. A fresh direct read of `model.doubled` does return 4; this is a dependency-tracking problem, not a cached accessor value.

### Workaround

Express derived values as `computed(() => model.a * 2)`, or read the required fields through the proxy directly in the effect, rather than relying on reads through an accessor's raw `this`.

### Proposed fix and validation

- For plain objects, read properties with `Reflect.get(target, property, receiver)` so accessors receive the proxy as `this`. Their internal property reads then re-enter the proxy and register dependencies.
- Apply the same receiver policy to the stored dependency `propertyGetter`, keeping initial reads and later source validation consistent.
- Classify receiver handling once per proxy. Retain raw receivers for other objects initially: native accessors such as `Map.prototype.size` and `Set.prototype.size` reject proxy receivers. Class accessors using private fields also need raw instances; support for arbitrary class and inherited accessors requires an explicit compatibility policy.
- Add regressions for getter input changes, conditional dependencies, and nested getter reads. Verify native collection accessors and class accessors using private fields continue to work under the selected policy.
- Measure size and performance before adopting the receiver-aware read path, since direct target access is currently an intentional optimization.

## Array callbacks bypass nested dependency tracking

Status: deferred; implementation unchanged. Review finding #1.

In [src/state.ts](./src/state.ts), wrapped methods execute with the raw target as `this`. Array methods therefore pass raw objects to callbacks. Reading their fields bypasses the proxy and does not establish dependencies on those fields.

### Scenario

```js
import { effect, EffectOptions, flushEffects, state } from '@slimlib/store';

const model = state({ items: [{ name: 'old' }] });
let observed;
const dispose = effect(() => {
    observed = model.items.map(item => item.name).join(',');
}, EffectOptions.EAGER);

model.items[0].name = 'new';
flushEffects();
// observed remains 'old'; expected 'new'.
dispose();
```

The callback's `item` is raw, so `item.name` is not tracked. A fresh direct call to `model.items.map(...)` sees the new name, but the existing effect is not notified by the nested property write.

### Workaround

Read each item through the proxy inside the callback, for example `model.items.map((_item, index) => model.items[index].name)`. This tracks the nested fields; it does not resolve the separate index/length notification issue below.

### Proposed fix and validation

- Ensure array callbacks receive reactive items, either by executing suitable array methods against the proxy or by adapting their callbacks. Preserve native collection receivers: a blanket change from raw targets to proxies would break methods such as `Map.prototype.get`.
- Define consistent behavior for callback `thisArg`, the callback's array argument, nested objects, sparse arrays, and returned item identity. Preserve mutation batching and avoid wrapping a method in a way that recursively calls itself through the proxy.
- Add regressions for nested field changes through callback methods such as `map`, `filter`, `find`, `forEach`, and `reduce`, including conditional dependencies and disposal. Verify mutating array methods and native collections retain their existing behavior.
- Measure size and performance before selecting the array-specific handling.

## Array index and length writes miss implicit mutations

Status: deferred; implementation unchanged. Review finding #2.

In [src/state.ts](./src/state.ts), the `set` and `defineProperty` traps notify dependents of the explicitly written property. JavaScript arrays can also change `length` when an index is written, or remove indices when `length` shrinks. Those implicit changes do not trigger separate proxy traps and currently miss their notifications.

### Scenarios

```js
import { effect, EffectOptions, flushEffects, state } from '@slimlib/store';

const growing = state([]);
let observedLength;
const stopLength = effect(() => {
    observedLength = growing.length;
}, EffectOptions.EAGER);

growing[0] = 1;
flushEffects();
// observedLength remains 0; expected 1.
stopLength();

const shrinking = state([1, 2, 3]);
let observedItem;
const stopItem = effect(() => {
    observedItem = shrinking[2];
}, EffectOptions.EAGER);

shrinking.length = 0;
flushEffects();
// observedItem remains 3; expected undefined.
stopItem();
```

There is also a mutation issue before notification: `state([])[5] = undefined` is skipped because the previous value compares equal to `undefined`. The assignment should still extend the array's length to 6. `Object.defineProperty` can produce the same implicit index/length changes and needs equivalent invalidation.

### Workaround

Where practical, keep the array in a state object's property and replace that property with a new array for structural updates. Effects that read the containing property can then observe the replacement without relying on implicit index/length notifications.

### Proposed fix and validation

- Add array-specific handling to both `set` and `defineProperty`. Capture the old length, perform the mutation, and compare the actual resulting length rather than assuming the requested value was applied.
- When an index write grows the array, notify the index and `length`. When length shrinks, notify `length` and tracked indices in the truncated range. Scan the existing dependency map rather than every possible removed index, keeping sparse-array truncation proportional to tracked dependencies.
- Account for structural changes even when old and new element values compare equal. Detect canonical array indices correctly: names such as `"01"` and `"4294967295"` are ordinary properties.
- Mark all affected dependencies before calling `scheduleFlush()` once, so synchronous scheduling does not observe partially invalidated state. Handle partial mutations on failure, such as truncation blocked by a non-configurable array element.
- Add regressions for growth, truncation, holes, assigning `undefined`, ordinary numeric-looking properties, and `Object.defineProperty`. Include effects combining index and length dependencies under both default and synchronous schedulers, plus computed source validation.
