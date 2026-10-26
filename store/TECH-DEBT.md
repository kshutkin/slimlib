# Technical debt

## Effect garbage collection and the documented lifetime contract

Status: deferred; implementation unchanged.

The README says that an effect created outside a scope needs its disposer to be retained to prevent garbage collection. The current implementation does not provide that behavior: a reachable reactive source strongly retains its subscribed effects, even when their disposers are no longer referenced.

### Current behavior

In [src/core.ts](./src/core.ts), `DepsSet` extends an ordinary `Set`, and dependency tracking adds effect nodes directly to it. For a signal, the reference chain is:

```text
reachable signal -> dependency Set -> effect node -> callback
```

Dropping the disposer does not break this chain. Calling it removes the subscriptions through `clearSources`. Disposing an owning scope also disposes its effects.

An entire unreachable signal/effect graph can still be collected; cyclic references alone do not prevent GC. The mismatch concerns effects subscribed to sources that remain reachable. Computeds have separate liveness tracking, so this observation should not be generalized to every reactive primitive.

A forced-GC probe against the current source confirmed that normal and failed eager-effect callbacks remain alive while their signal remains reachable. A callback in an entirely unreachable signal/effect graph was collected. The development `FinalizationRegistry` warning is diagnostic; it does not unsubscribe effects.

### Related failure: eager setup throws before returning a disposer

In [src/effect.ts](./src/effect.ts), the initial eager `runner()` call propagates errors without rolling back subscriptions established before the throw:

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
    // effect() never returned its disposer.
}

value.set(1);
flushEffects();
// runs === 2, although initial setup failed and dispose is undefined.
```

The read of `value()` subscribes the effect before the exception. As long as the signal stays reachable, the failed effect can run again and retain resources captured by its callback.

### Workaround

Explicitly dispose effects, either through their returned disposers or an owning scope. Retaining a disposer is useful for teardown, but dropping it is not a way to stop the effect. For an eager setup failure that prevents receiving a disposer, an explicitly created owning scope can still be disposed by the caller.

### Resolution and validation

- Decide whether to restore the documented collection behavior for unowned effects or revise the public lifetime contract and README examples to require explicit teardown while sources remain reachable. A change to dependency ownership needs size and performance measurements.
- Independently, roll back subscriptions and registration when the initial eager run throws. Garbage collection, even with weak subscriptions, would not provide immediate or deterministic rollback.
- Add GC regressions with a reachable source and a dropped disposer, an unreachable whole graph, and effects kept alive by a disposer or scope. Existing computed GC coverage does not establish the effect lifetime contract.
- Add a regression proving that changing a source after eager setup fails does not re-run the failed effect, including when another effect still depends on that source.

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
