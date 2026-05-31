/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenerationHost} GenerationHost */
/** @typedef {import('../utils/pubsub.js').Listener} Listener */
import { MOVE } from '../symbols.js';
import { emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onMove = () => ElementBase =>
    class extends ElementBase {
        /** @type {Listener[]} */
        [MOVE] = [];

        connectedMoveCallback() {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), MOVE);
        }
    };
