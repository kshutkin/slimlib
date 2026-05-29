/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @param {(host: SlimHost) => void} fn
 * @returns {Middleware}
 */
export const onMove = fn => Base =>
    class extends Base {
        connectedMoveCallback() {
            fn(/** @type {SlimHost} */ (/** @type {unknown} */ (this)));
        }
    };
