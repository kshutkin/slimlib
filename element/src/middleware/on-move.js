/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenHost} GenHost */
import { MOVE } from '../lifecycle.js';
import { createList, emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const onMove = () => ElementBase =>
    class extends ElementBase {
        [MOVE] = createList();

        connectedMoveCallback() {
            emit(/** @type {GenHost} */ (/** @type {unknown} */ (this)), MOVE);
        }
    };
