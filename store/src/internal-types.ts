/**
 * Internal types used for implementation - not part of public API
 */

/**
 * Extended Set type with deps version tracking for non-live polling
 * Used for monkey-patching $_depsVersion onto Set instances
 */
export type DepsSet<T> = Set<T> & { $_version?: number };

/**
 * Source entry for state/signal dependencies
 * State sources use $_depsVersion, $_getter, and $_storedValue for change detection
 */
export type StateSourceEntry<T = unknown> = {
    $_dependents: Set<ReactiveNode>;
    $_node: undefined;
    $_version: number;
    $_getter: () => T;
    $_storedValue: T;
};

/**
 * Source entry for computed dependencies
 * Computed sources use $_version for change detection
 */
export type ComputedSourceEntry = {
    $_dependents: Set<ReactiveNode>;
    $_node: ReactiveNode;
    $_version: number;
};

/**
 * Union type for all source entries
 */
export type SourceEntry<T = unknown> = StateSourceEntry<T> | ComputedSourceEntry;

/**
 * Base type for reactive nodes (computed and effect)
 * Uses $_ prefixed properties for minification
 */
export type ReactiveNode = InternalComputed<unknown> & InternalEffect;

/**
 * Internal computed type with all implementation properties
 * Mirrors the original Computed type - used internally for full property access
 */
export type InternalComputed<T> = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode>;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_lastGlobalVersion: number;
    $_value: T;
    $_getter: () => T;
    $_equals: (a: T, b: T) => boolean;
};

/**
 * Internal effect type with all implementation properties
 */
export type InternalEffect = (() => void) & {
    $_sources: SourceEntry[];
    $_flags: number;
    $_skipped: number;
    $_id: number;
};

/**
 * Internal scope type with known symbol-keyed properties
 * Used internally to access scope internals that are not exposed in public Scope type
 */
export type InternalScope = {
    [key: symbol]: unknown;
};
