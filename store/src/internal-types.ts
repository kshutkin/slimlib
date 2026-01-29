/**
 * Internal types used for implementation - not part of public API
 * 
 * This implementation uses a Link-based architecture inspired by alien-signals.
 * A single Link object participates in two doubly-linked lists simultaneously:
 * 1. As an entry in the subscriber's "deps" list (sources it depends on)
 * 2. As an entry in the dependency's "subs" list (subscribers that depend on it)
 * 
 * Properties are prefixed with $_ to enable minification via rollup plugin.
 */

/**
 * Link object that connects a subscriber to a dependency.
 * This is the core data structure that enables efficient dependency tracking.
 * 
 * Each Link participates in TWO doubly-linked lists:
 * - deps list: subscriber's list of dependencies (via $_prevDep/$_nextDep)
 * - subs list: dependency's list of subscribers (via $_prevSub/$_nextSub)
 */
export interface Link {
    /** Version number for tracking changes (used for polling optimization) */
    $_version: number;
    /** The dependency node (what this subscriber depends on) */
    $_dep: Subscribable;
    /** The subscriber node (who depends on this dependency) */
    $_sub: ReactiveNode;
    /** Previous link in the dependency's subs list */
    $_prevSub: Link | undefined;
    /** Next link in the dependency's subs list */
    $_nextSub: Link | undefined;
    /** Previous link in the subscriber's deps list */
    $_prevDep: Link | undefined;
    /** Next link in the subscriber's deps list */
    $_nextDep: Link | undefined;
    /** For state/signal sources: getter function to retrieve current value */
    $_getter: (() => unknown) | undefined;
    /** For state/signal sources: last seen value for polling optimization */
    $_storedValue: unknown;
}

/**
 * Base interface for anything that can be subscribed to.
 * This includes signals, state properties, and computed nodes.
 */
export interface Subscribable {
    /** Head of the subscribers linked list */
    $_subs: Link | undefined;
    /** Tail of the subscribers linked list */
    $_subsTail: Link | undefined;
    /** Version number - incremented when value changes (for state/signal polling) */
    $_version: number;
}

/**
 * Base type for reactive nodes (computed and effect)
 */
export interface ReactiveNode extends Subscribable {
    /** Head of the dependencies linked list (sources this node depends on) */
    $_deps: Link | undefined;
    /** Tail of the dependencies linked list */
    $_depsTail: Link | undefined;
    /** Bit flags for node state */
    $_flags: number;
    /** Cached computed value */
    $_value: unknown;
    /** Last seen global version (for fast-path optimization) */
    $_lastGlobalVersion: number;
    /** Getter function for computed nodes */
    $_getter: (() => unknown) | undefined;
    /** Equality function for computed nodes */
    $_equals: ((a: unknown, b: unknown) => boolean) | undefined;
}

/**
 * Internal effect type with all implementation properties
 */
export interface EffectNode extends ReactiveNode {
    /** Effect ID for ordering */
    $_id: number;
    /** Effect callback function */
    $_fn: (() => void) | undefined;
}

/**
 * Internal scope type with known symbol-keyed properties
 * Used internally to access scope internals that are not exposed in public Scope type
 */
export type InternalScope = {
    [key: symbol]: unknown;
};