/**
 * @import { Computed, Scope } from './index.js'
 */

export let flushScheduled = false;

// Computation tracking state
/** @type {Computed<any> | null} */
export let currentComputing = null;
export let tracked = true;

/**
 * Set the current computing node
 * @param {Computed<any> | null} node
 */
export const setCurrentComputing = node => {
    currentComputing = node;
};

/**
 * Set the tracked flag
 * @param {boolean} value
 */
export const setTracked = value => {
    tracked = value;
};

/**
 * Set the flush scheduled flag
 * @param {boolean} value
 */
export const setFlushScheduled = value => {
    flushScheduled = value;
};

/**
 * Active scope for effect tracking
 * When set, effects created will be tracked to this scope
 * Can be set via setActiveScope() or automatically during scope() callbacks
 * @type {Scope | undefined}
 */
export let activeScope = undefined;

/**
 * Set the active scope for effect tracking
 * Effects created outside of a scope() callback will be tracked to this scope
 * Pass undefined to clear the active scope
 * @param {Scope | undefined} scope - The scope to set as active, or undefined to clear
 * @returns {void}
 */
export const setActiveScope = scope => {
    activeScope = scope;
};

/**
 * Global version counter - increments on every signal/state write
 * Used for fast-path: if globalVersion hasn't changed since last read, skip all checks
 */
export let globalVersion = 0;

/**
 * Increment the global version counter
 */
export const incrementGlobalVersion = () => {
    globalVersion++;
};

/**
 * Scheduler function used to schedule effect execution
 * Defaults to queueMicrotask, can be replaced with setScheduler
 * @type {(callback: () => void) => void}
 */
export let scheduler = queueMicrotask;

/**
 * Set a custom scheduler function for effect execution
 * @param {(callback: () => void) => void} newScheduler - The new scheduler function
 * @returns {void}
 */
export const setScheduler = newScheduler => {
    scheduler = newScheduler;
};
