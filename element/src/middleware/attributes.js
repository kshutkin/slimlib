import { DEV } from 'esm-env';

import { effect } from '@slimlib/store';

/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @typedef {[parse?: (raw: string | null) => unknown, serialize?: (value: unknown) => (string | null)]} AttributeDescriptor
 *   Positional tuple. `parse` converts an inbound attribute string (`string | null`)
 *   into a prop value; when omitted the attribute is not observed (no prop is
 *   written on attribute changes). `serialize` converts a prop value into an
 *   attribute string, or `null` to remove the attribute; when
 *   `serialize` is present the attribute is reflected.
 */

/**
 * Observe HTML attributes, parse them into props, and optionally reflect prop
 * writes back to the DOM.
 *
 * `config` is a tuple-descriptor map (`{ count: numberAttr }`). Each descriptor
 * is a `[parse?, serialize?]` tuple; presence of `serialize` reflects the prop
 * write back to the attribute.
 *
 * @param {Record<string, AttributeDescriptor>} config
 * @returns {Middleware}
 */
export const attributes = config => {
    const names = Object.keys(config);
    const observedKeys = names.filter(name => config[name]?.[0]);
    const reflectedKeys = names.filter(name => config[name]?.[1]);

    return Base => {
        return class extends /** @type {new (...args: unknown[]) => HTMLElement & { connectedCallback(): void; disconnectedCallback(): void }} */ (
            /** @type {unknown} */ (Base)
        ) {
            /** @type {null | (() => void)} */
            #reflectDispose = null;

            static get observedAttributes() {
                return observedKeys;
            }

            attributeChangedCallback(/** @type {string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
                /** @type {SlimHost} */ (/** @type {unknown} */ (this))[name] = /** @type {[parse: (raw: string | null) => unknown]} */ (
                    config[name]
                )[0](value);
            }

            connectedCallback() {
                super.connectedCallback();

                if (DEV) {
                    for (const name of reflectedKeys) {
                        if (!Object.getOwnPropertyDescriptor(this, name)?.get) {
                            console.warn(
                                `[@slimlib/element] attribute "${name}" is reflected (has a serialize function) but was not declared via props(); reflection won't track changes.`
                            );
                        }
                    }
                }

                if (!this.#reflectDispose && reflectedKeys.length > 0) {
                    const disposers = reflectedKeys.map(name => {
                        const descriptor = /** @type {AttributeDescriptor} */ (config[name]);
                        const parse = descriptor[0];
                        const serialize = /** @type {NonNullable<AttributeDescriptor[1]>} */ (descriptor[1]);
                        return effect(() => {
                            const host = /** @type {SlimHost} */ (/** @type {unknown} */ (this));
                            const out = serialize(host[name]);
                            if (DEV && parse) {
                                const back = serialize(parse(out));
                                if (back !== out) {
                                    throw new Error(
                                        `[@slimlib/element] attribute "${name}" [parse, serialize] pair is not round-trip stable: serialize(parse(${JSON.stringify(out)})) === ${JSON.stringify(back)} (expected ${JSON.stringify(out)}); reflection would loop.`
                                    );
                                }
                            }
                            if (out == null) {
                                if (host.hasAttribute(name)) host.removeAttribute(name);
                            } else if (host.getAttribute(name) !== out) {
                                host.setAttribute(name, out);
                            }
                        }, 1 /* EAGER */);
                    });
                    this.#reflectDispose = () => {
                        for (const dispose of disposers) dispose();
                    };
                }
            }

            disconnectedCallback() {
                this.#reflectDispose?.();
                this.#reflectDispose = null;
                super.disconnectedCallback();
            }
        };
    };
};

/** @type {AttributeDescriptor} */
export const numberAttr = [raw => (raw === null ? null : Number(raw)), value => (value == null ? null : String(value))];

/** @type {AttributeDescriptor} */
export const boolAttr = [raw => raw !== null, value => (value ? '' : null)];

/** @type {AttributeDescriptor} */
export const stringAttr = [raw => raw, value => (value == null ? null : String(value))];
