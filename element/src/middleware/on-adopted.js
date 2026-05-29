/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @param {(host: SlimHost, oldDoc: Document, newDoc: Document) => void} fn
 * @returns {Middleware}
 */
export const onAdopted = fn => Base =>
    class extends Base {
        adoptedCallback(/** @type {Document} */ oldDoc, /** @type {Document} */ newDoc) {
            fn(/** @type {SlimHost} */ (/** @type {unknown} */ (this)), oldDoc, newDoc);
        }
    };
