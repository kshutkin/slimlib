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
 * A computed value that automatically tracks dependencies and caches results
 */
export type Computed<T> = (() => T) & { [key: symbol]: any; i?: number };

/**
 * Source entry for tracking dependencies
 */
export type SourceEntry<T = any> = {
    d: Set<Computed<any>>;
    n: Computed<any> | undefined;
    v: number;
    dv: number;
    g?: () => T;
    sv?: T;
};

/**
 * Effect type - internal representation
 */
export type Effect<T> = (() => T) & { [key: symbol]: any; i?: number };