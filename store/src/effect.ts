import { batchedAddNew, checkComputedSources, clearSources, runWithTracking, scheduleFlush } from './core';
import { cycleMessage, registerEffect, unregisterEffect, warnIfNoActiveScope } from './debug';
import { Flag } from './flags';
import { activeScope } from './globals';
import { trackSymbol } from './symbols';
import type { ReactiveNode } from './internal-types';
import type { EffectCleanup } from './types';

/**
 * Effect creation counter - increments on every effect creation
 * Used to maintain effect execution order by creation time
 */
let effectCreationCounter = 0;

/**
 * Creates a reactive effect that runs when dependencies change
 */
// biome-ignore lint/suspicious/noConfusingVoidType: void is semantically correct here - callback may return nothing or a cleanup function
export const effect = (callback: () => void | EffectCleanup): (() => void) => {
    let disposed = false;

    // Register effect for GC tracking (only in DEV mode)
    const gcToken = registerEffect();

    // Warn if effect is created without an active scope (only in DEV mode when enabled)
    warnIfNoActiveScope(activeScope);

    // Create effect node as a plain object (same shape as computed nodes)
    // for V8 hidden class monomorphism across all ReactiveNode instances
    //
    // $_value: stores cleanup function returned by the effect callback
    // $_stamp: creation order counter for effect scheduling
    // $_fn: the effect runner function (set below)
    const node = {
        $_sources: [],
        $_deps: undefined,
        $_flags: Flag.DIRTY | Flag.EFFECT,
        $_skipped: 0,
        $_version: 0,
        $_value: undefined as unknown,
        $_stamp: ++effectCreationCounter,
        $_fn: undefined as (() => void) | undefined,
        $_equals: undefined,
    } as unknown as ReactiveNode;

    const effectId = node.$_stamp;

    // Effect runner function stored in $_fn
    node.$_fn = () => {
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
    batchedAddNew(node, effectId);
    scheduleFlush();

    return dispose;
};