/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../utils/pubsub.js').GenerationHost} GenerationHost */
/** @typedef {import('../utils/pubsub.js').Listener} Listener */
import { FORM_ASSOCIATED, FORM_DISABLED, FORM_RESET, FORM_STATE_RESTORE } from '../symbols.js';
import { emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const formAssociated = () => ElementBase => {
    class FormAssociatedElement extends ElementBase {
        static formAssociated = true;

        /** @type {Listener[]} */
        [FORM_ASSOCIATED] = [];
        /** @type {Listener[]} */
        [FORM_DISABLED] = [];
        /** @type {Listener[]} */
        [FORM_RESET] = [];
        /** @type {Listener[]} */
        [FORM_STATE_RESTORE] = [];

        formAssociatedCallback(/** @type {HTMLFormElement | null} */ form) {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), FORM_ASSOCIATED, form);
        }

        formDisabledCallback(/** @type {boolean} */ isDisabled) {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), FORM_DISABLED, isDisabled);
        }

        formResetCallback() {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), FORM_RESET);
        }

        formStateRestoreCallback(/** @type {unknown} */ state, /** @type {string} */ mode) {
            emit(/** @type {GenerationHost} */ (/** @type {unknown} */ (this)), FORM_STATE_RESTORE, state, mode);
        }
    }

    return FormAssociatedElement;
};
