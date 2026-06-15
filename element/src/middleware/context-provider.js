/** @typedef {import('../types.js').ElementHost} ElementHost */
/** @typedef {import('../types.js').Middleware} Middleware */
/**
 * @template KeyType, ValueType
 * @typedef {import('../utils/context-types.js').Context<KeyType, ValueType>} Context
 */
/** @typedef {import('../utils/context-types.js').UnknownContext} UnknownContext */
/**
 * @template {UnknownContext} T
 * @typedef {import('../utils/context-types.js').ContextType<T>} ContextType
 */
/**
 * @template {UnknownContext} T
 * @typedef {import('../utils/context-types.js').ContextRequestEventLike<T>} ContextRequestEventLike
 */

/**
 * Provide a Web Components Context Protocol value from each element instance.
 *
 * The factory runs once per host instance. Return a stable value, typically a
 * reactive primitive from `@slimlib/store`; consumers observe or mutate that
 * object directly after requesting it.
 *
 * @template {UnknownContext} T
 * @param {T} context
 * @param {(host: ElementHost) => ContextType<T>} factory
 * @returns {Middleware}
 */
export const contextProvider = (context, factory) => ElementBase =>
    class extends ElementBase {
        /** @type {ContextType<T>} */
        #contextValue;

        constructor() {
            super();
            this.#contextValue = factory(/** @type {ElementHost} */ (/** @type {unknown} */ (this)));
            this.addEventListener('context-request', event => {
                const contextRequest = /** @type {ContextRequestEventLike<T>} */ (event);
                if (contextRequest.context !== context) {
                    return;
                }
                contextRequest.stopImmediatePropagation();
                contextRequest.callback(this.#contextValue);
            });
        }
    };
