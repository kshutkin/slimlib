/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @param {(host: SlimHost) => void} callback
 * @returns {Middleware}
 */
export const onMove = callback => ElementBase =>
    class extends ElementBase {
        connectedMoveCallback() {
            callback(/** @type {SlimHost} */ (/** @type {unknown} */ (this)));
        }
    };
