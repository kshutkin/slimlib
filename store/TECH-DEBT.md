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
