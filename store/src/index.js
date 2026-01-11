/**
 * Cleanup function returned by effect callback
 * @typedef {() => void} EffectCleanup
 */

/**
 * Callback function for onDispose registration
 * @typedef {(cleanup: () => void) => void} OnDisposeCallback
 */

/**
 * Callback function passed to scope
 * @typedef {(onDispose: OnDisposeCallback) => void} ScopeCallback
 */

/**
 * Function type for creating or disposing a scope
 * When called with a callback, extends the scope; when called without arguments, disposes the scope
 * @typedef {((callback: ScopeCallback) => Scope) & (() => undefined)} ScopeFunction
 */

/**
 * A reactive scope for managing effect lifecycles
 * Scopes can be nested and automatically clean up their tracked effects when disposed
 * @typedef {ScopeFunction & { [key: symbol]: any }} Scope
 */

/**
 * Signal type - a callable that returns the current value with a set method
 * @template T
 * @typedef {(() => T) & { set: (value: T) => void }} Signal
 */

/**
 * A computed value that automatically tracks dependencies and caches results
 * @template T
 * @typedef {(() => T) & { [key: symbol]: any }} Computed
 */

// Re-export public API from all modules

// Reactive primitives
export { computed, untracked } from './computed.js';
// Core utilities
export { flushEffects, unwrapValue } from './core.js';
// Debug configuration
export { debugConfig, SUPPRESS_EFFECT_GC_WARNING, WARN_ON_UNTRACKED_EFFECT, WARN_ON_WRITE_IN_COMPUTED } from './debug.js';
export { effect } from './effect.js';
// Global state accessors
export { activeScope, setActiveScope, setScheduler } from './globals.js';
// Scope
export { scope } from './scope.js';
export { signal } from './signal.js';
export { state } from './state.js';
