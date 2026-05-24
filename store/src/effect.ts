import { batchedAddNew, checkComputedSources, clearSources, DepsSet, noopGetter, runWithTracking, scheduleFlush } from './core';
import { cycleMessage, registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug';
import { Flag } from './flags';
import { activeScope } from './globals';
import { trackSymbol } from './symbols';
import type { ReactiveNode } from './internal-types';
import type { EffectCleanup } from './types';

const enum EffectOptionsValues {
    DEFERRED = 0, // Default behavior: schedule effect to run in a microtask after the current execution context
    EAGER = 1 << 0, // Run effect immediately during setup instead of scheduling a microtask
}

/**
 * Bitflag-style options controlling effect creation.
 *
 * Pass one of these values as the second argument to {@link effect}.
 *
 * Today only the first-run scheduling mode is encoded; future flags will be
 * combinable via bitwise OR. Internal callers in @slimlib/* can also pass the
 * raw numeric literals (`0` for DEFERRED, `1` for EAGER) to avoid pulling the
 * enum-like struct into their bundle.
 *
 * | Member     | Value | First run                                              | Error handling                                                                                  |
 * | ---------- | ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
 * | `DEFERRED` | `0`   | Scheduled on the active scheduler (default microtask). | Caught by the flush loop and logged via `console.error` — caller of `effect()` never sees them. |
 * | `EAGER`    | `1`   | Runs synchronously inside the `effect()` call.         | Thrown synchronously to the caller — preserves the stack trace and is catchable with try/catch. |
 *
 * Behavior shared by both modes:
 *  - Dependency tracking is identical: signals/state/computed reads inside the
 *    callback subscribe the effect to re-run on change.
 *  - Re-runs (after the first one) always go through the scheduler.
 *  - The returned dispose function and the optional cleanup-function-return
 *    contract are identical.
 *
 * Implications worth knowing:
 *  - With `EAGER`, the surrounding scope and `activeScope` are valid during
 *    the first run, so any sub-scopes created inside the callback are
 *    parented correctly. With `DEFERRED`, `activeScope` is usually
 *    `undefined` by the time the flush runs — capture it at setup if needed.
 *  - `EAGER` makes signal mutations that synchronously trigger an effect
 *    cycle visible at the call site. With `DEFERRED` they're noticed only
 *    once the flush runs.
 *  - Choosing `EAGER` does not change re-run semantics; only the first run is
 *    promoted from a microtask to inline execution.
 */
export const EffectOptions = {
    DEFERRED: 0,
    EAGER: 1,
} as const;

/**
 * Numeric union of the values in {@link EffectOptions} (`0 | 1`). Accepted as
 * the second argument to {@link effect}.
 */
export type EffectOptions = typeof EffectOptions[keyof typeof EffectOptions];

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 0;

/**
 * Creates a reactive effect that runs when dependencies change.
 *
 * @param callback - Function to run; may return an {@link EffectCleanup} to be
 *                   invoked before each re-run and on dispose.
 * @param eager    - One of {@link EffectOptions}. Default `DEFERRED` schedules
 *                   the first run on the active scheduler. `EAGER` runs the
 *                   first invocation synchronously inside `effect()` — errors
 *                   propagate to the caller (catchable with try/catch),
 *                   whereas errors in deferred first runs are caught by the
 *                   flush loop and reported via `console.error`.
 * @returns        - Dispose function that stops re-runs and invokes the last
 *                   cleanup.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: void is semantically correct here - callback may return nothing or a cleanup function
export const effect = (callback: () => void | EffectCleanup, eager: EffectOptions = EffectOptionsValues.DEFERRED): (() => void) => {
    let disposed = false;

    // Register effect for GC tracking (only in DEV mode)
    const gcToken = registerEffect();

    // Warn if effect is created without an active scope (only in DEV mode when enabled)
    warnIfNoActiveScope(activeScope);

    // Declare node first so the runner closure can capture it.
    // The variable will be assigned before the runner is ever called.
    let node: ReactiveNode;

    // Define the runner function BEFORE creating the node so that $_fn
    // is a function from the start (Fix #1: avoids hidden class transition
    // from undefined → function on the $_fn field).
    const runner = () => {
        // Skip if effect was disposed (may still be in batched queue from before disposal)
        if (disposed) {
            return;
        }

        // Cycle detection: if this node is already being computed, we have a cycle
        const flags = node.$_flags;
        if ((flags & Flag.COMPUTING) !== 0) {
            throw new Error(cycleMessage);
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Verify if sources actually changed before running
        // ----------------------------------------------------------------
        // Bail-out optimization: if only CHECK flag is set (not DIRTY),
        // verify that computed sources actually changed before running
        if ((flags & (Flag.DIRTY | Flag.CHECK | Flag.HAS_STATE_SOURCE)) === Flag.CHECK) {
            // PULL: Read computed sources to check if they changed
            // If false, sources didn't change - clear CHECK flag and skip
            // If true, sources changed or errored - proceed to run
            if (!checkComputedSources(node.$_sources)) {
                node.$_flags = flags & ~Flag.CHECK;
                return;
            }
        }

        // ----------------------------------------------------------------
        // PULL PHASE: Execute effect and track dependencies
        // ----------------------------------------------------------------
        runWithTracking(node, () => {
            // Run previous cleanup if it exists (stored in $_value)
            if (typeof node.$_value === 'function') {
                (node.$_value as EffectCleanup)();
            }
            // Run the callback and store new cleanup in $_value
            // (callback will PULL values from signals/state/computed)
            node.$_value = callback();
        });
    };

    // Create effect node as a plain object with IDENTICAL initial field types
    // as computed nodes to ensure V8 hidden class monomorphism (Fix #2):
    //   $_deps:   new DepsSet() (Set object, same as computed — never used for effects)
    //   $_fn:     runner (function, same as computed's getter)
    //   $_equals: Object.is (function, same as computed's equality comparator)
    //
    // $_value: stores cleanup function returned by the effect callback
    // $_stamp: creation order counter for effect scheduling
    node = {
        $_sources: [],
        $_deps: new DepsSet<ReactiveNode>(noopGetter),
        $_flags: Flag.DIRTY | Flag.EFFECT,
        $_skipped: 0,
        $_version: 0,
        $_value: undefined as unknown,
        $_stamp: ++effectCreationCounter,
        $_fn: runner,
        $_equals: Object.is,
    } as unknown as ReactiveNode;

    const effectId = node.$_stamp;

    const dispose = (): void => {
        // Mark as disposed to prevent running if still in batched queue
        disposed = true;
        // Unregister from GC tracking (only in DEV mode)
        unregisterEffect(gcToken);
        // Run cleanup if it exists (stored in $_value)
        if (typeof node.$_value === 'function') {
            (node.$_value as EffectCleanup)();
        }
        clearSources(node);
    };

    // Track to appropriate scope
    if (activeScope) {
        (activeScope[trackSymbol] as (dispose: () => void) => void)(dispose);
    }

    // ----------------------------------------------------------------
    // Initial scheduling (triggers first PULL when flush runs)
    // ----------------------------------------------------------------
    // Trigger first run via batched queue
    // node is already dirty
    // and effect is for sure with the latest id so we directly adding without the sort
    if (eager === EffectOptionsValues.DEFERRED) {
        batchedAddNew(node, effectId);
        scheduleFlush();
    } else {
        // For eager effects, run immediately (in the same tick) instead of
        // scheduling a microtask. Errors thrown by the first run propagate
        // synchronously to the caller of effect() — by design: this gives a
        // useful stack trace and lets surrounding code handle the failure
        // with try/catch. (Deferred runs cannot do this because the runner
        // executes inside a queueMicrotask callback, where thrown errors
        // would become unhandled rejections; the flush loop logs them via
        // console.error instead.)
        runner();
    }

    return dispose;
};
