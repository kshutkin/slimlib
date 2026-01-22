/**
 * Internal types used for implementation - not part of public API
 */

/**
 * Extended Set type with deps version tracking for non-live polling
 * Used for monkey-patching $_depsVersion onto Set instances
 */
export type DepsSet<T> = Set<T> & { $_depsVersion?: number };

/**
 * Source entry for tracking dependencies
 */
export type SourceEntry<T = any> = {
    $_dependents: DepsSet<ReactiveNode>;
    $_node: ReactiveNode | undefined;
    $_version: number;
    $_depsVersion: number;
    $_getter?: () => T;
    $_storedValue?: T;
};

/**
 * Base type for reactive nodes (computed and effect)
 * Uses $_ prefixed properties for minification
 */
export type ReactiveNode = (() => void) & {
    $_sources: SourceEntry[];
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_deps?: Set<ReactiveNode>;
    $_lastGlobalVersion?: number;
    $_value?: any;
    $_getter?: () => any;
    $_equals?: (a: any, b: any) => boolean;
    $_id?: number;
};

/**
 * Internal computed type with all implementation properties
 * Mirrors the original Computed type - used internally for full property access
 */
export type InternalComputed<T> = (() => T) & {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode>;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_lastGlobalVersion?: number;
    $_value?: T;
    $_getter?: () => T;
    $_equals?: (a: T, b: T) => boolean;
    $_id?: number;
};

/**
 * Internal effect type with all implementation properties
 */
export type InternalEffect = (() => void) & {
    $_sources: SourceEntry[];
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_id?: number;
};