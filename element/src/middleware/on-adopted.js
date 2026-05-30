/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenerationHost} GenerationHost */
/** @typedef {import('../utils/pubsub.js').Listener} Listener */
import { ADOPTED } from '../symbols.js';
import { emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onAdopted = () => ElementBase =>
    class extends ElementBase {
        /** @type {Listener[]} */
        [ADOPTED] = [];

        adoptedCallback(/** @type {Document} */ oldDocument, /** @type {Document} */ newDocument) {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), ADOPTED, oldDocument, newDocument);
        }
    };
