/**
 * Internal types used for implementation - not part of public API
 */

/**
 * Extended Set type with deps version tracking for non-live polling
 * Used for monkey-patching $_depsVersion onto Set instances
 */
export type DepsSet<T> = Set<T> & { $_version?: number; $_getter?: () => unknown };

/**
 * Source entry for dependencies (unified for monomorphism)
 * Properties are initialized for both types to ensure consistent hidden class
 */
export type SourceEntry<T = unknown> = {
    $_dependents: Set<ReactiveNode>;
    $_node: ReactiveNode | undefined;
    $_version: number;
    $_getter: (() => T) | undefined;
    $_storedValue: T | undefined;
};

export type StateSourceEntry<T = unknown> = SourceEntry<T>;
export type ComputedSourceEntry = SourceEntry;

/**
 * Base type for reactive nodes (computed and effect)
 * Uses $_ prefixed properties for minification
 *
 * Both computed and effect nodes are plain objects and MUST initialize ALL
 * of these properties in the same order to ensure V8 hidden class monomorphism.
 * Property initialization order:
 *   $_sources, $_deps, $_flags, $_skipped, $_version,
 *   $_value, $_lastGlobalVersion, $_getter, $_equals, $_id, $_run
 */
export type ReactiveNode = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode> | undefined;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: unknown;
    $_lastGlobalVersion: number;
    $_getter: (() => unknown) | undefined;
    $_equals: ((a: unknown, b: unknown) => boolean) | undefined;
    $_id: number;
    $_run: (() => void) | undefined;
};

/**
 * Internal computed type with all implementation properties
 * Mirrors the original Computed type - used internally for full property access
 * Includes $_id and $_run for shape consistency with effects
 */
export type InternalComputed<T> = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode> | undefined;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: T;
    $_lastGlobalVersion: number;
    $_getter: (() => T) | undefined;
    $_equals: ((a: T, b: T) => boolean) | undefined;
    $_id: number;
    $_run: (() => void) | undefined;
};

/**
 * Internal effect type with all implementation properties
 * Now a plain object (not function-based) for V8 hidden class consistency
 * with computed nodes. The $_run property holds the effect runner function.
 */
export type InternalEffect = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode> | undefined;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: unknown;
    $_lastGlobalVersion: number;
    $_getter: (() => unknown) | undefined;
    $_equals: ((a: unknown, b: unknown) => boolean) | undefined;
    $_id: number;
    $_run: (() => void) | undefined;
};

/**
 * Internal scope type with known symbol-keyed properties
 * Used internally to access scope internals that are not exposed in public Scope type
 */
export type InternalScope = {
    [key: symbol]: unknown;
};