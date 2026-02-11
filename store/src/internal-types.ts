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
 *   $_value, $_stamp, $_fn, $_equals
 *
 * Several fields serve different purposes depending on node type:
 *   $_value  — Computed: cached value or thrown error. Effect: cleanup function.
 *   $_stamp  — Computed: last seen globalVersion (fast-path cache). Effect: creation order (scheduling).
 *   $_fn     — Computed: getter function. Effect: runner function.
 *   $_equals — Computed: equality comparator. Effect: Object.is (unused, for hidden class monomorphism).
 *   $_deps   — Computed: set of dependent consumers. Effect: empty DepsSet (unused, for hidden class monomorphism).
 *   $_version — Computed: value change counter. Effect: 0 (unused).
 */
export type ReactiveNode = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode>;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: unknown;
    $_stamp: number;
    $_fn: (() => unknown) | undefined;
    $_equals: ((a: unknown, b: unknown) => boolean) | undefined;
};

/**
 * Internal computed type with all implementation properties
 * Mirrors the original Computed type - used internally for full property access
 *
 * $_value: cached computed value or thrown error
 * $_stamp: last seen globalVersion for fast-path cache validation
 * $_fn: the getter function that computes the value
 * $_equals: equality comparator to detect value changes
 */
export type InternalComputed<T> = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode>;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: T;
    $_stamp: number;
    $_fn: (() => T) | undefined;
    $_equals: ((a: T, b: T) => boolean) | undefined;
};

/**
 * Internal effect type with all implementation properties
 * Plain object with same hidden class shape as computed nodes.
 *
 * IMPORTANT: All fields must be initialized with the same VALUE TYPES as
 * computed nodes to ensure V8 hidden class monomorphism:
 *   $_deps:   createDepsSet() (Set object, same as computed — unused for effects)
 *   $_fn:     runner function (function, same as computed's getter)
 *   $_equals: Object.is (function, same as computed's equality comparator — unused for effects)
 *
 * $_value: cleanup function returned by the effect callback
 * $_stamp: creation order counter for effect scheduling
 */
export type InternalEffect = {
    $_sources: SourceEntry[];
    $_deps: Set<ReactiveNode>;
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_value: unknown;
    $_stamp: number;
    $_fn: (() => void) | undefined;
    $_equals: ((a: unknown, b: unknown) => boolean) | undefined;
};

/**
 * Internal scope type with known symbol-keyed properties
 * Used internally to access scope internals that are not exposed in public Scope type
 */
export type InternalScope = {
    [key: symbol]: unknown;
};
