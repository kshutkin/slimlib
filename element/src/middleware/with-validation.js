import { DEV } from 'esm-env';

import { INTERNALS } from '../symbols.js';

/**
 * @typedef {object} ValidationHost
 * @property {ValidityState} validity
 * @property {string} validationMessage
 * @property {boolean} willValidate
 * @property {HTMLFormElement | null} form
 * @property {NodeList} labels
 * @property {() => boolean} checkValidity
 * @property {() => boolean} reportValidity
 */

/**
 * Expose the `ElementInternals` constraint-validation surface on the host element.
 *
 * @returns {import('../types.js').Middleware<ValidationHost>}
 */
export const withValidation = () => ElementBase =>
    class extends ElementBase {
        get validity() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).validity;
        }

        get validationMessage() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).validationMessage;
        }

        get willValidate() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).willValidate;
        }

        get form() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).form;
        }

        get labels() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).labels;
        }

        checkValidity() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).checkValidity();
        }

        reportValidity() {
            if (DEV && !/** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]) {
                console.error('withValidation() requires the withInternals() middleware');
                return;
            }
            return /** @type {ElementInternals} */ (
                /** @type {Record<typeof INTERNALS, ElementInternals | undefined>} */ (/** @type {unknown} */ (this))[INTERNALS]
            ).reportValidity();
        }
    };
