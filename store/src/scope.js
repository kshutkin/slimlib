/**
 * @import { Scope, ScopeCallback } from './index.js'
 */

import { safeForEach } from './debug.js';
import { activeScope, setActiveScope } from './globals.js';
import { childrenSymbol, trackSymbol } from './symbols.js';

/**
 * Creates a reactive scope for tracking effects
 * Effects created within a scope callback are automatically tracked and disposed together
 *
 * @param {ScopeCallback} [callback] - Optional callback to run in scope context
 * @param {Scope | undefined | null} [parent=activeScope] - Parent scope (defaults to activeScope, pass undefined for no parent)
 * @returns {Scope} A scope function that can extend the scope or dispose it
 */
export const scope = (callback, parent = activeScope) => {
    /** @type {Set<() => void>} */
    const effects = new Set();
    /** @type {Set<Scope>} */
    const children = new Set();
    /** @type {Array<() => void>} */
    const cleanups = [];
    let disposed = false;

    const guard = () => {
        if (disposed) {
            throw new Error('Scope is disposed');
        }
    };

    /**
     * Register a cleanup function to run when scope is disposed
     * @param {() => void} cleanup
     */
    const onDispose = cleanup => {
        guard();
        cleanups.push(cleanup);
    };

    /**
     * @type {Scope}
     */
    const ctx = /** @type {Scope} */ (
        cb => {
            guard();

            if (cb === undefined) {
                // Dispose
                disposed = true;

                // Dispose children first (depth-first)
                safeForEach(children);

                // Stop all effects
                safeForEach(effects);
                effects.clear();

                // Run cleanup handlers
                safeForEach(cleanups);

                // Remove from parent
                if (parent) {
                    parent[childrenSymbol].delete(ctx);
                }

                return;
            }

            // Extend scope - run callback in this scope's context
            const prev = activeScope;
            setActiveScope(ctx);
            try {
                cb(onDispose);
            } finally {
                setActiveScope(prev);
            }
            return ctx;
        }
    );

    // Internal symbols for effect tracking and child management
    ctx[trackSymbol] = /** @param {() => void} dispose */ dispose => effects.add(dispose);
    ctx[childrenSymbol] = children;

    // Register with parent
    if (parent) {
        parent[childrenSymbol].add(ctx);
    }

    // Run initial callback if provided
    if (callback) {
        ctx(callback);
    }

    return ctx;
};
