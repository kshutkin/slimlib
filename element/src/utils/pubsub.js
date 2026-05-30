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
 * is untagged for that key (a permanent subscription pushed directly onto the
 * list) or while its tag still matches the host generation. `emit` drops stale
 * listeners in place as it dispatches. Tagging per key lets one function take
 * part in several lists without the lists interfering.
 */

/** @typedef {(...args: any[]) => void} Listener */
/** @typedef {Listener & Record<symbol, number | undefined>} TaggedListener */
/** @typedef {Record<symbol, Listener[]> & Record<typeof RENDER_GEN, number>} GenHost */

/** Host field holding the current render generation (number). */
export const RENDER_GEN = Symbol();

/**
 * Emit to every alive listener in `host[key]`, in registration order, compacting
 * stale render-time listeners out of the list in the same forward pass. A
 * listener is alive when it is untagged for `key` (permanent) or when its
 * `listener[key]` tag still matches `host[RENDER_GEN]`; a stale listener has its
 * tag cleared and is dropped. A throwing listener does not block the others.
 * Subscribing to or unsubscribing from the same list during an emit is
 * unsupported (the forward loop may skip).
 *
 * @param {GenHost} host
 * @param {symbol} key
 * @param {...any} args
 * @returns {void}
 */
export const emit = (host, key, ...args) => {
    const list = /** @type {Listener[]} */ (host[key]);
    const aliveGen = host[RENDER_GEN];
    const length = list.length;
    let writeIndex = 0;
    for (let index = 0; index < length; ++index) {
        const listener = /** @type {TaggedListener} */ (list[index]);
        const gen = listener[key];
        if (gen === undefined || gen === aliveGen) {
            list[writeIndex++] = listener;
            try {
                listener(...args);
            } catch (error) {
                console.error(error);
            }
        } else {
            listener[key] = undefined;
        }
    }
    list.length = writeIndex;
};
