/**
 * Internal types used for implementation - not part of public API
 */

/**
 * Extended Set type with deps version tracking for non-live polling.
 * Used for monkey-patching $_depsVersion onto Set instances.
 */
export type DepsSet<T> = Set<T> & { $_version: number; $_getter: () => unknown };

/**
 * Source entry for dependencies (unified for monomorphism).
 * Properties are initialized for both types to ensure consistent hidden class.
 */
export type SourceEntry<T = unknown> = {
    $_dependents: Set<ReactiveNode>;
    $_node: ReactiveNode | undefined;
    $_version: number;
    $_getter: (() => T) | undefined;
    $_storedValue: T | undefined;
};

/**
 * Base type for reactive nodes (computed and effect).
 * Uses $_ prefixed properties for minification.
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