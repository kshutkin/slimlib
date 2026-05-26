import { DEV } from 'esm-env';

import { render } from '@slimlib/jsx';
import { state } from '@slimlib/store';

/**
 * @typedef {HTMLElement & Record<string, unknown>} SlimHost
 */

/**
 * @typedef {(host: SlimHost) => unknown} SlimRender
 */

/**
 * Define and register a light-DOM custom element backed by `@slimlib/jsx`.
 *
 * Reactive properties are declared inside the render callback via `extend(host, {...})`.
 * `attrs` is the list of attribute names the browser should observe; attribute writes
 * flow into the host via `this[name] = value`, picked up by the accessor `extend` installs.
 *
 * @overload
 * @param {string} tag
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
/**
 * @overload
 * @param {string} tag
 * @param {string[]} attrs
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
/**
 * @param {string} tag
 * @param {string[] | SlimRender} attrsOrRender
 * @param {SlimRender} [maybeRender]
 * @returns {CustomElementConstructor}
 */
export const defineElement = (tag, attrsOrRender, maybeRender) => {
    const hasAttrs = Array.isArray(attrsOrRender);
    const attrs = hasAttrs ? attrsOrRender : [];
    const userRender = /** @type {SlimRender} */ (hasAttrs ? maybeRender : attrsOrRender);

    const ElementBase = createElementClass(attrs, userRender);
    const Ctor = DEV ? createNamedElementClass(tag, ElementBase) : ElementBase;

    customElements.define(tag, Ctor);
    return Ctor;
};

/**
 * @param {string} tag
 * @param {CustomElementConstructor} ElementBase
 * @returns {CustomElementConstructor}
 */
const createNamedElementClass = (tag, ElementBase) => {
    const className = tag.replace(/(^|-)(\w)/g, (_, _d, c) => c.toUpperCase());
    return /** @type {CustomElementConstructor} */ ({ [className]: class extends ElementBase {} }[className]);
};

/**
 * @param {string[]} attrs
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
const createElementClass = (attrs, userRender) =>
    class extends HTMLElement {
        #mounted = false;
        /** @type {null | (() => void)} */
        #dispose = null;

        static get observedAttributes() {
            return attrs;
        }

        attributeChangedCallback(/** @type {string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
            /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (this))[name] = value;
        }

        connectedCallback() {
            if (!this.#mounted) {
                this.#mounted = true;
                this.#dispose = render(
                    () => /** @type {any} */ (userRender(/** @type {SlimHost} */ (/** @type {unknown} */ (this)))),
                    this
                );
            }
        }

        async disconnectedCallback() {
            await Promise.resolve();
            if (!this.isConnected && this.#mounted) {
                this.#mounted = false;
                this.#dispose?.();
                this.#dispose = null;
            }
        }
    };

/**
 * Declare JS-only reactive properties on a slim element instance.
 *
 * Returns the underlying `state()` proxy so render code can use it directly
 * (`reactiveProps.count++`) while external code goes through the installed `host.count`
 * accessor. Adopts any own property already on the host (e.g. from
 * `attributeChangedCallback` or a pre-define `el.count = …`).
 *
 * @template {Record<string, unknown>} P
 * @param {SlimHost} host
 * @param {P} props
 * @returns {P}
 */
export const extend = (host, props) => {
    const reactiveProps = /** @type {P} */ (state({ ...props }));
    for (const key of Object.keys(props)) {
        if (Object.hasOwn(host, key)) {
            /** @type {Record<string, unknown>} */ (reactiveProps)[key] = host[key];
            delete host[key];
        }
        Object.defineProperty(host, key, {
            configurable: true,
            enumerable: true,
            get() {
                return reactiveProps[key];
            },
            set(value) {
                /** @type {Record<string, unknown>} */ (reactiveProps)[key] = value;
            },
        });
    }
    return reactiveProps;
};
