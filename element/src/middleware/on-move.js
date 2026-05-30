/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenHost} GenHost */
/** @typedef {import('../utils/pubsub.js').Listener} Listener */
import { MOVE } from '../lifecycle.js';
import { emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onMove = () => ElementBase =>
    class extends ElementBase {
        /** @type {Listener[]} */
        [MOVE] = [];

        connectedMoveCallback() {
            emit(/** @type {GenHost} */ (/** @type {unknown} */ (this)), MOVE);
        }
    };
