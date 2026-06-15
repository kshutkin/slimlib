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
import { ContextRequestEvent } from '../utils/context-request-event.js';

// Per-instance state packed into one numeric field. Kept as plain module-local
// consts (not an enum object) so the minifier inlines the literals and nothing
// is emitted at runtime.
const DECIDED = 1;
const PROVIDING = 2;

/**
 * Provide a Web Components Context Protocol value, but only when no ancestor
 * already provides the same context.
 *
 * On the element's first connection the middleware probes its ancestors with a
 * one-shot `context-request`: if an existing provider answers, this element
 * stays transparent and descendants keep resolving to that provider; otherwise
 * this element becomes the root provider for the context. The decision is made
 * once per instance and the `factory` runs at most once, lazily, and only when
 * this element actually becomes the provider.
 *
 * @template {UnknownContext} T
 * @param {T} context
 * @param {(host: ElementHost) => ContextType<T>} factory
 * @returns {Middleware}
 */
export const rootContextProvider = (context, factory) => ElementBase => {
    const Base = /** @type {new (...args: any[]) => HTMLElement & { connectedCallback?(): void }} */ (ElementBase);
    return class extends Base {
        /** @type {ContextType<T> | undefined} */
        #value;
        #flags = 0;

        constructor() {
            super();
            this.addEventListener('context-request', event => {
                const contextRequest = /** @type {ContextRequestEventLike<T>} */ (event);
                // Stay transparent until this element has decided to provide, so
                // the probe below bubbles past our own listener to ancestors.
                if (contextRequest.context !== context || !(this.#flags & PROVIDING)) {
                    return;
                }
                contextRequest.stopImmediatePropagation();
                contextRequest.callback(/** @type {ContextType<T>} */ (this.#value));
            });
        }

        connectedCallback() {
            if (!(this.#flags & DECIDED)) {
                this.#flags |= DECIDED;
                let provided = false;
                // Probe ancestors. PROVIDING is still unset, so this element's own
                // listener stays transparent and the request bubbles past it.
                this.dispatchEvent(
                    new ContextRequestEvent(context, () => {
                        provided = true;
                    })
                );
                if (!provided) {
                    this.#flags |= PROVIDING;
                    this.#value = factory(/** @type {ElementHost} */ (/** @type {unknown} */ (this)));
                }
            }
            super.connectedCallback?.();
        }
    };
};
