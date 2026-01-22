/**
 * Public types for the reactive store
 */

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
 * Calling the function returns the current computed value
 */
export type Computed<T> = () => T;

/**
 * An effect is represented by its dispose function
 * Calling this function will stop the effect and run any cleanup
 */
export type Effect = () => void;