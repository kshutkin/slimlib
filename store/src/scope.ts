import { safeForEach } from './debug';
import { DisposerNode, drainDisposers, registerDisposer, unlinkDisposer } from './disposer-list';
import { activeScope, setActiveScope } from './globals';
import { parentSymbol, skipScopeRemoval, trackSymbol } from './symbols';
import type { OnDisposeCallback, Scope, ScopeCallback, ScopeParent } from './types';

/**
 * Creates a reactive scope for tracking effects
 * Effects created within a scope callback are automatically tracked and disposed together
 */
export const scope = (callback?: ScopeCallback, parent: Scope | undefined = activeScope): Scope => {
    const cleanups: Array<() => void> = [];

    /**
     * Register a cleanup function to run when scope is disposed
     */
    const onDispose: OnDisposeCallback = cleanup => {
        if (ctx[trackSymbol] !== undefined) cleanups.push(cleanup);
    };

    const run = (cb?: ScopeCallback | symbol) => {
        const disposers = ctx[trackSymbol] as DisposerNode | undefined;
        if (!cb || cb === skipScopeRemoval) {
            if (disposers === undefined) return;

            // Close registration before draining the list in creation order.
            ctx[trackSymbol] = undefined;
            unlinkDisposer(registration, cb as symbol | undefined);
            registration = undefined;
            drainDisposers(disposers);
            safeForEach(cleanups);

            return;
        }

        // Extend scope - silently ignore if disposed
        if (disposers === undefined) return ctx;

        // Run callback in this scope's context
        const prev = activeScope;
        setActiveScope(ctx);
        try {
            (cb as ScopeCallback)(onDispose);
        } finally {
            setActiveScope(prev);
        }
        return ctx;
    };
    const ctx = run as Scope;

    ctx[trackSymbol] = new DisposerNode(run);
    ctx[parentSymbol] = parent;
    const parentDisposers = parent?.[trackSymbol] as DisposerNode | undefined;
    let registration = parentDisposers === undefined ? undefined : registerDisposer(parentDisposers, run);

    // Run initial callback if provided
    if (callback) {
        ctx(callback);
    }

    return ctx;
};

export const getParentScope = (scope: ScopeParent): ScopeParent | undefined => scope[parentSymbol] as ScopeParent | undefined;
