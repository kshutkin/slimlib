import { render } from '@slimlib/jsx';
import { signal } from '@slimlib/store';

/**
 * @template {Record<string, unknown>} [P=Record<string, unknown>]
 * @typedef {object} ElementOptions
 * @property {string} tag - must contain a hyphen
 * @property {P} [props] - default values; each becomes a reactive accessor on the element backed by a signal
 * @property {readonly (Extract<keyof P, string>)[]} [observedAttributes] - attribute names mirrored to props (string-coerced for now)
 * @property {ShadowRootInit | boolean} [shadow] - true => { mode: 'open' }
 * @property {(ctx: ElementContext<P>) => unknown} setup - returns JSX to render into the host
 */

/**
 * @template {Record<string, unknown>} P
 * @typedef {object} ElementContext
 * @property {HTMLElement} element
 * @property {ShadowRoot | HTMLElement} root - where setup() output is rendered
 * @property {{ readonly [K in keyof P]: import('@slimlib/store').Signal<P[K]> }} props
 */

/**
 * Define and register a custom element backed by @slimlib/jsx.
 * @template {Record<string, unknown>} P
 * @param {ElementOptions<P>} options
 * @returns {CustomElementConstructor}
 */
export const defineElement = options => {
    const { tag, props: defaults = /** @type {P} */ ({}), observedAttributes = [], shadow, setup } = options;
    const propKeys = /** @type {(keyof P & string)[]} */ (Object.keys(defaults));

    class SlimElement extends HTMLElement {
        constructor() {
            super();
            /** @type {{ [K in keyof P]: import('@slimlib/store').Signal<P[K]> }} */
            // @ts-expect-error - populated below
            this._p = {};
            for (const key of propKeys) {
                this._p[key] = signal(defaults[key]);
            }
            // lazy upgrade: properties set before definition end up as own props
            for (const key of propKeys) {
                if (Object.prototype.hasOwnProperty.call(this, key)) {
                    const v = /** @type {P[typeof key]} */ (/** @type {Record<string, unknown>} */ (this)[key]);
                    delete (/** @type {Record<string, unknown>} */ (this))[key];
                    /** @type {Record<string, unknown>} */ (this)[key] = v;
                }
            }
            /** @type {(() => void) | undefined} */
            this._dispose = undefined;
            // TODO: attachInternals() - form association, ARIA reflection
        }

        static get observedAttributes() {
            return observedAttributes;
        }

        attributeChangedCallback(/** @type {keyof P & string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
            const s = this._p[name];
            if (s) s.set(/** @type {P[typeof name]} */ (/** @type {unknown} */ (value)));
            // TODO: typed attribute coercion
        }

        connectedCallback() {
            const root = shadow
                ? this.attachShadow(shadow === true ? { mode: 'open' } : shadow)
                : this;
            this._dispose = render(() => /** @type {any} */ (setup({ element: this, root, props: this._p })), /** @type {Element | DocumentFragment} */ (/** @type {unknown} */ (root)));
        }

        disconnectedCallback() {
            this._dispose?.();
            this._dispose = undefined;
        }
    }

    for (const key of propKeys) {
        Object.defineProperty(SlimElement.prototype, key, {
            configurable: true,
            enumerable: true,
            get() {
                return this._p[key]();
            },
            set(v) {
                this._p[key].set(v);
            }
        });
    }

    customElements.define(tag, SlimElement);
    return SlimElement;
};
