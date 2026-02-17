import { safeForEach } from './debug';
import { activeScope, setActiveScope } from './globals';
import { childrenSymbol, trackSymbol } from './symbols';
import type { OnDisposeCallback, Scope, ScopeCallback } from './types';

/**
 * Creates a reactive scope for tracking effects
 * Effects created within a scope callback are automatically tracked and disposed together
 */
export const scope = (callback?: ScopeCallback, parent: Scope | undefined | null = activeScope): Scope => {
    const effects: (() => void)[] = [];
    const children: Scope[] = [];
    const cleanups: Array<() => void> = [];
    let disposed = false;
    let myIndex = -1;

    /**
     * Register a cleanup function to run when scope is disposed
     */
    const onDispose: OnDisposeCallback = cleanup => {
        if (disposed) {
            return;
        }
        cleanups.push(cleanup);
    };

    const ctx = ((cb?: ScopeCallback) => {
        if (!cb) {
            // Dispose - return early if already disposed (idempotent)
            if (disposed) {
                return;
            }
            // Dispose
            disposed = true;

            // Dispose children first (depth-first)
            safeForEach(children);

            // Stop all effects
            safeForEach(effects);
            effects.length = 0;

            // Run cleanup handlers
            safeForEach(cleanups);

            // Remove from parent
            if (parent) {
                (parent[childrenSymbol] as (Scope | undefined)[])[myIndex] = undefined;
            }

            return;
        }

        // Extend scope - silently ignore if disposed
        if (disposed) {
            return ctx;
        }

        // Run callback in this scope's context
        const prev = activeScope;
        setActiveScope(ctx);
        try {
            cb(onDispose);
        } finally {
            setActiveScope(prev);
        }
        return ctx;
    }) as Scope;

    // Internal symbols for effect tracking and child management
    ctx[trackSymbol] = (dispose: () => void) => effects.push(dispose);
    ctx[childrenSymbol] = children;

    // Register with parent
    if (parent) {
        myIndex = (parent[childrenSymbol] as Scope[]).push(ctx) - 1;
    }

    // Run initial callback if provided
    if (callback) {
        ctx(callback);
    }

    return ctx;
};
