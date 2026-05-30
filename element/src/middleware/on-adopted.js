/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @param {(host: SlimHost, oldDocument: Document, newDocument: Document) => void} callback
 * @returns {Middleware}
 */
export const onAdopted = callback => ElementBase =>
    class extends ElementBase {
        adoptedCallback(/** @type {Document} */ oldDocument, /** @type {Document} */ newDocument) {
            callback(/** @type {SlimHost} */ (/** @type {unknown} */ (this)), oldDocument, newDocument);
        }
    };
