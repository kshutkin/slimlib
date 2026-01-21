import type { Scope } from './types';

/**
 * Active scope for effect tracking
 * When set, effects created will be tracked to this scope
 * Can be set via setActiveScope() or automatically during scope() callbacks
 */
export let activeScope: Scope | undefined;

/**
 * Set the active scope for effect tracking
 * Effects created outside of a scope() callback will be tracked to this scope
 * Pass undefined to clear the active scope
 */
export const setActiveScope = (scope: Scope | undefined): void => {
    activeScope = scope;
};

/**
 * Scheduler function used to schedule effect execution
 * Defaults to queueMicrotask, can be replaced with setScheduler
 */
export let scheduler: (callback: () => void) => void = queueMicrotask;

/**
 * Set a custom scheduler function for effect execution
 */
export const setScheduler = (newScheduler: (callback: () => void) => void): void => {
    scheduler = newScheduler;
};
