/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenHost} GenHost */
import { ADOPTED } from '../lifecycle.js';
import { createList, emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onAdopted = () => ElementBase =>
    class extends ElementBase {
        [ADOPTED] = createList();

        adoptedCallback(/** @type {Document} */ oldDocument, /** @type {Document} */ newDocument) {
            emit(/** @type {GenHost} */ (/** @type {unknown} */ (this)), ADOPTED, oldDocument, newDocument);
        }
    };
