/**
 * Minimal per-key pub/sub over symbol-keyed listener arrays stored directly on a
 * host object. Each message type lives in its own `host[key]` array. Arrays are
 * used over Sets because the realistic listener count per event is tiny (1-3),
 * where array iteration is faster and leaner than Set iteration.
 */

/** @typedef {(...args: any[]) => void} Listener */

/**
 * @returns {Listener[]}
 */
export const createList = () => [];

/**
 * Subscribe a listener to `list`. Returns an unsubscribe function.
 *
 * @param {Listener[]} list
 * @param {Listener} listener
 * @returns {() => void}
 */
export const on = (list, listener) => {
    list.push(listener);
    return () => {
        const index = list.indexOf(listener);
        if (index >= 0) {
            list.splice(index, 1);
        }
    };
};

/**
 * Emit to every listener in `list`, in registration order. A throwing listener
 * does not block the others. Subscribing to or unsubscribing from the same list
 * during an emit is unsupported (the forward loop may skip).
 *
 * @param {Listener[]} list
 * @param {...any} args
 * @returns {void}
 */
export const emit = (list, ...args) => {
    for (let index = 0; index < list.length; index++) {
        try {
            /** @type {Listener} */ (list[index])(...args);
        } catch (error) {
            console.error(error);
        }
    }
};
