/**
 * Minimal per-key pub/sub over symbol-keyed listener arrays stored directly on a
 * host object. Each message type lives in its own `host[key]` array. Arrays are
 * used over Sets because the realistic listener count per event is tiny (1-3),
 * where array iteration is faster and leaner than Set iteration.
 *
 * Render-time listeners are not unsubscribed eagerly. Instead the host carries a
 * generation counter at `host[RENDER_GEN]` that advances on every genuine
 * unmount, and each render-time listener is tagged, per list, with the
 * generation it was registered in: the list's own symbol key doubles as the tag
 * key on the listener (`listener[key]`). A listener is alive in a list while it
 * is untagged for that key (a permanent subscription added through `on`) or
 * while its tag still matches the host generation; stale listeners are dropped
 * lazily by `compact` whenever a list is iterated. Tagging per key lets one
 * function take part in several lists without the lists interfering.
 */

/** @typedef {(...args: any[]) => void} Listener */
/** @typedef {Listener & Record<symbol, number | undefined>} TaggedListener */
/** @typedef {Record<symbol, Listener[]> & Record<typeof RENDER_GEN, number>} GenHost */

/** Host field holding the current render generation (number). */
export const RENDER_GEN = Symbol();

/**
 * @returns {Listener[]}
 */
export const createList = () => [];

/**
 * Subscribe a permanent listener to `list`. Permanent listeners are untagged,
 * so they survive generation-based compaction (use this for middleware-owned
 * subscriptions that should outlive render cycles).
 *
 * @param {Listener[]} list
 * @param {Listener} listener
 * @returns {void}
 */
export const on = (list, listener) => {
    list.push(listener);
};

/**
 * Drop stale render-time listeners from `list` in place. A listener survives
 * when it is untagged for `key` (permanent, added through `on`) or when its
 * `listener[key]` tag still matches `aliveGen`. A dropped listener has its tag
 * cleared so a later re-subscription (or reuse as a permanent `on` listener)
 * starts untagged.
 *
 * @param {Listener[]} list
 * @param {symbol} key
 * @param {number} aliveGen
 * @returns {void}
 */
export const compact = (list, key, aliveGen) => {
    let writeIndex = 0;
    for (let index = 0; index < list.length; ++index) {
        const listener = /** @type {TaggedListener} */ (list[index]);
        const gen = listener[key];
        if (gen === undefined || gen === aliveGen) {
            list[writeIndex++] = listener;
        } else {
            listener[key] = undefined;
        }
    }
    list.length = writeIndex;
};

/**
 * Emit to every alive listener in `host[key]`, in registration order. Stale
 * render-time listeners are compacted away first. A throwing listener does not
 * block the others. Subscribing to or unsubscribing from the same list during an
 * emit is unsupported (the forward loop may skip).
 *
 * @param {GenHost} host
 * @param {symbol} key
 * @param {...any} args
 * @returns {void}
 */
export const emit = (host, key, ...args) => {
    const list = /** @type {Listener[]} */ (host[key]);
    const aliveGen = host[RENDER_GEN];
    compact(list, key, aliveGen);
    const length = list.length;
    for (let index = 0; index < length; ++index) {
        try {
            /** @type {Listener} */ (list[index])(...args);
        } catch (error) {
            console.error(error);
        }
    }
};
