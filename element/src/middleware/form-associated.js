/** @typedef {import('../types.js').Middleware} Middleware */
import { FORM_ASSOCIATED, FORM_DISABLED, FORM_RESET, FORM_STATE_RESTORE } from '../lifecycle.js';
import { createList, emit } from '../utils/pubsub.js';

/**
 * @returns {Middleware}
 */
export const formAssociated = () => ElementBase => {
    class FormAssociatedElement extends ElementBase {
        static formAssociated = true;

        [FORM_ASSOCIATED] = createList();
        [FORM_DISABLED] = createList();
        [FORM_RESET] = createList();
        [FORM_STATE_RESTORE] = createList();

        formAssociatedCallback(/** @type {HTMLFormElement | null} */ form) {
            emit(this[FORM_ASSOCIATED], form);
        }

        formDisabledCallback(/** @type {boolean} */ isDisabled) {
            emit(this[FORM_DISABLED], isDisabled);
        }

        formResetCallback() {
            emit(this[FORM_RESET]);
        }

        formStateRestoreCallback(/** @type {unknown} */ state, /** @type {string} */ mode) {
            emit(this[FORM_STATE_RESTORE], state, mode);
        }
    }

    return FormAssociatedElement;
};
