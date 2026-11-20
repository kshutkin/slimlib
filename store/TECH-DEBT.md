# Technical debt

## Effect slots accumulate in long-lived scopes

Status: deferred.

Disposing an effect clears its scope slot immediately. Cleared slots stay in the array, so array capacity and teardown scans grow with the total number of registrations since scope creation, even if the number of live effects stays small. Scope disposal clears the registration array.

Consider stable compaction only if long-lived scopes with frequent manual disposal justify it. Measure heap growth and teardown time with a small live population and many historical registrations. Preserve cleanup order when relocating entries.

## Child-scope slots accumulate in long-lived parents

Status: deferred.

In [src/scope.ts](./src/scope.ts#L70-L78), a child scope appends itself to its parent's `children` array. Disposing the child [sets its slot to `undefined`](./src/scope.ts#L46-L49). This releases the parent's reference to the child, while the slot stays in the array. Storage and the final teardown scan grow with the number of children the parent has ever registered. Parent teardown does not truncate the array, so its storage can persist if the disposed parent stays reachable.

This can happen through ordinary rendering. The JSX renderer creates a child scope when it replaces a [reactive subtree](../jsx/src/core.ts#L129-L155) or adds a [keyed list item](../jsx/src/core.ts#L481-L497). A long-lived keyed list can keep a fixed number of visible rows while its parent scope accumulates one cleared slot for every item it replaces. The individual effects can be static within each child scope. This workload is separate from repeatedly creating and manually disposing effects in the same scope.

To measure the impact, keep the list mounted with a fixed number of rows, replace keys repeatedly across update cycles, and measure retained heap after GC and final parent teardown time. Compare with updating rows that keep their keys. Any slot reuse or compaction should preserve child teardown order and account for children that dispose themselves during teardown.

## Effects created in a disposed active scope remain live

Status: deferred.

In [src/scope.ts](./src/scope.ts), calling a scope without a callback disposes it but does not change `activeScope`. An enclosing scope callback or effect runner restores the previous active scope only when it returns. Code that continues executing in that context can therefore create effects owned by an already disposed scope.

### Scenario

```js
import { effect, EffectOptions, flushEffects, scope, signal } from '@slimlib/store';

const value = signal(0);
const owner = scope();
let runs = 0;

owner(() => {
    owner();
    effect(() => {
        value();
        runs++;
    }, EffectOptions.EAGER);
});

value.set(1);
flushEffects();
owner(); // Already disposed: does not stop the newly registered effect.
// runs === 2; the effect remains subscribed.
```

The same situation can occur when an eager callback disposes its own scope, or when teardown callbacks create effects while the disposed owner remains active. Registrations appended during effect teardown can also fall outside its initial iteration boundary. Ordinary disposal after the scope callback has returned does not by itself leave that scope active.

### Workaround

Finish creating owned effects before disposing the scope. If code can create an effect after its owner has been disposed, retain and call the effect's individual disposer rather than relying on another scope-disposal call.

### Proposed fix and validation

- Define the policy for creating effects under a disposed active owner: reject creation, return an inert disposer, or give the effect another explicit owner. Silently ignoring the callback is an observable API decision.
- A closed-registration marker and a creation guard are one possible implementation. Account for child, effect, and scope cleanup callbacks, and avoid reopening a disposed registry.
- Cover eager and deferred creation after explicit disposal inside an active callback, creation during teardown, repeated scope disposal, and queued work. Preserve existing teardown order and exception isolation.

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
