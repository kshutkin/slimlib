/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @typedef {object} FormAssociatedHandlers
 * @property {(host: SlimHost, form: HTMLFormElement | null) => void} [associated]
 * @property {(host: SlimHost, disabled: boolean) => void} [disabled]
 * @property {(host: SlimHost) => void} [reset]
 * @property {(host: SlimHost, state: unknown, mode: string) => void} [stateRestore]
 */

/**
 * @param {FormAssociatedHandlers} [handlers]
 * @returns {Middleware}
 */
export const formAssociated =
    (handlers = {}) =>
    Base => {
        class FormAssociatedElement extends Base {
            static formAssociated = true;
        }

        if (Object.hasOwn(handlers, 'associated')) {
            const associated = /** @type {NonNullable<FormAssociatedHandlers['associated']>} */ (handlers.associated);
            Object.defineProperty(FormAssociatedElement.prototype, 'formAssociatedCallback', {
                configurable: true,
                value(/** @type {HTMLFormElement | null} */ form) {
                    return associated(this, form);
                },
            });
        }
        if (Object.hasOwn(handlers, 'disabled')) {
            const disabled = /** @type {NonNullable<FormAssociatedHandlers['disabled']>} */ (handlers.disabled);
            Object.defineProperty(FormAssociatedElement.prototype, 'formDisabledCallback', {
                configurable: true,
                value(/** @type {boolean} */ isDisabled) {
                    return disabled(this, isDisabled);
                },
            });
        }
        if (Object.hasOwn(handlers, 'reset')) {
            const reset = /** @type {NonNullable<FormAssociatedHandlers['reset']>} */ (handlers.reset);
            Object.defineProperty(FormAssociatedElement.prototype, 'formResetCallback', {
                configurable: true,
                value() {
                    return reset(this);
                },
            });
        }
        if (Object.hasOwn(handlers, 'stateRestore')) {
            const stateRestore = /** @type {NonNullable<FormAssociatedHandlers['stateRestore']>} */ (handlers.stateRestore);
            Object.defineProperty(FormAssociatedElement.prototype, 'formStateRestoreCallback', {
                configurable: true,
                value(/** @type {unknown} */ state, /** @type {string} */ mode) {
                    return stateRestore(this, state, mode);
                },
            });
        }

        return FormAssociatedElement;
    };
