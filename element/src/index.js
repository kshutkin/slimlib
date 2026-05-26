import { render } from '@slimlib/jsx';
import { state } from '@slimlib/store';

/**
 * @template {Record<string, unknown>} [P=Record<string, unknown>]
 * @typedef {HTMLElement & P} SlimHost
 */

/**
 * @template {Record<string, unknown>} [P=Record<string, unknown>]
 * @typedef {(host: SlimHost<P>) => unknown} SlimRender
 */

/**
 * Define and register a light-DOM custom element backed by `@slimlib/jsx`
 * and `@slimlib/store`'s `state()`.
 *
 * Each instance gets a single `state({...defaults})` proxy with prototype
 * getter/setters installed for every key so `host.foo` reads and
 * `host.foo = v` (or `host.foo++`) flow through the reactive proxy.
 *
 * `observedAttributes` is derived from `Object.keys(defaults)`; attribute
 * changes write the raw string into the state (typed coercion is a future
 * addition — see IDEAS.md #4).
 */
/**
 * @overload
 * @param {string} tag
 * @param {SlimRender} render
 * @returns {CustomElementConstructor}
 */
/**
 * @template {Record<string, unknown>} P
 * @overload
 * @param {string} tag
 * @param {P} defaults
 * @param {SlimRender<P>} render
 * @returns {CustomElementConstructor}
 */
/**
 * @param {string} tag
 * @param {Record<string, unknown> | SlimRender} defaultsOrRender
 * @param {SlimRender} [maybeRender]
 * @returns {CustomElementConstructor}
 */
export const defineElement = (tag, defaultsOrRender, maybeRender) => {
    const hasDefaults = typeof defaultsOrRender !== 'function';
    /** @type {Record<string, unknown>} */
    const defaults = hasDefaults ? /** @type {Record<string, unknown>} */ (defaultsOrRender) : {};
    const userRender = /** @type {SlimRender} */ (hasDefaults ? maybeRender : defaultsOrRender);
    const propKeys = Object.keys(defaults);

    class SlimElement extends HTMLElement {
        /** @type {Record<string, unknown>} */
        #props = state({ ...defaults });
        /** @type {(() => void) | undefined} */
        #dispose;

        static {
            for (const key of propKeys) {
                Object.defineProperty(this.prototype, key, {
                    configurable: true,
                    enumerable: true,
                    get() {
                        return this.#props[key];
                    },
                    set(v) {
                        this.#props[key] = v;
                    }
                });
            }
        }

        constructor() {
            super();
            // lazy upgrade: own-properties set before definition flow through the setter
            for (const key of propKeys) {
                if (Object.hasOwn(this, key)) {
                    const self = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (this));
                    const v = self[key];
                    delete self[key];
                    self[key] = v;
                }
            }
            // TODO: attachInternals() — form association, ARIA reflection (IDEAS.md #4 + future)
        }

        static get observedAttributes() {
            return propKeys;
        }

        attributeChangedCallback(/** @type {string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
            this.#props[name] = value; // TODO: typed attribute coercion (IDEAS.md #4)
        }

        connectedCallback() {
            this.#dispose = render(
                () => /** @type {any} */ (userRender(/** @type {SlimHost} */ (/** @type {unknown} */ (this)))),
                this
            );
        }

        disconnectedCallback() {
            this.#dispose?.();
            this.#dispose = undefined;
        }
    }

    customElements.define(tag, SlimElement);
    return SlimElement;
};
