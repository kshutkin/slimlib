/** @typedef {import('../types.js').Middleware} Middleware */
import { ADOPTED } from '../lifecycle.js';
import { createList, emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onAdopted = () => ElementBase =>
    class extends ElementBase {
        [ADOPTED] = createList();

        adoptedCallback(/** @type {Document} */ oldDocument, /** @type {Document} */ newDocument) {
            emit(this[ADOPTED], oldDocument, newDocument);
        }
    };
