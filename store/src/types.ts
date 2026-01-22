/**
 * Cleanup function returned by effect callback
 */
export type EffectCleanup = () => void;

/**
 * Callback function for onDispose registration
 */
export type OnDisposeCallback = (cleanup: () => void) => void;

/**
 * Callback function passed to scope
 */
export type ScopeCallback = (onDispose: OnDisposeCallback) => void;

/**
 * Function type for creating or disposing a scope
 * When called with a callback, extends the scope; when called without arguments, disposes the scope
 */
export type ScopeFunction = ((callback: ScopeCallback) => Scope) & (() => undefined);

/**
 * A reactive scope for managing effect lifecycles
 * Scopes can be nested and automatically clean up their tracked effects when disposed
 */
export type Scope = ScopeFunction & { [key: symbol]: any };

/**
 * Signal type - a callable that returns the current value with a set method
 */
export type Signal<T> = (() => T) & { set: (value: T) => void };

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
 * Source entry for tracking dependencies
 */
export type SourceEntry<T = any> = {
    $_dependents: Set<ReactiveNode>;
    $_node: ReactiveNode | undefined;
    $_version: number;
    $_depsVersion: number;
    $_getter?: () => T;
    $_storedValue?: T;
};

/**
 * A computed value that automatically tracks dependencies and caches results
 */
export type Computed<T> = (() => T) & {
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
 * Effect type - internal representation
 */
export type Effect<T> = (() => T) & {
    $_sources: SourceEntry[];
    $_flags: number;
    $_skipped: number;
    $_version: number;
    $_id?: number;
};