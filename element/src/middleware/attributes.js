import { DEV } from 'esm-env';

import { effect } from '@slimlib/store';

/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @typedef {object} AttributeDescriptor
 * @property {NumberConstructor | BooleanConstructor | StringConstructor | ((raw: string | null) => unknown)} [type]
 *   Coercion applied to inbound attribute values. `Number`/`Boolean`/`String`
 *   global constructors are recognized specially; any other function is called
 *   as `type(raw)`. Omitted means string passthrough.
 * @property {boolean} [reflect] When true, JS writes to the prop are reflected
 *   back to the DOM attribute.
 */

/**
 * Coerce an inbound attribute value (`string | null`) into a prop value.
 *
 * @param {AttributeDescriptor['type']} type
 * @param {string | null} raw
 * @returns {unknown}
 */
const coerceIn = (type, raw) => {
    if (type === Boolean) return raw !== null;
    if (raw === null) return null;
    if (type === Number) return Number(raw);
    if (type === String || type === undefined) return raw;
    return type(raw);
};

/**
 * Reflect a prop value out to the DOM attribute. The "only write if different"
 * checks are the loop guard: a redundant write is skipped, so the
 * reflect → setAttribute → attributeChangedCallback → prop cycle terminates.
 *
 * Reads `host[name]` itself so the read happens inside the reflecting effect and
 * tracks the reactive prop.
 *
 * @param {SlimHost} host
 * @param {string} name
 * @param {AttributeDescriptor['type']} type
 * @returns {void}
 */
const reflectOut = (host, name, type) => {
    const value = host[name];
    if (type === Boolean) {
        if (value) {
            if (!host.hasAttribute(name)) host.setAttribute(name, '');
        } else if (host.hasAttribute(name)) {
            host.removeAttribute(name);
        }
    } else if (value == null) {
        if (host.hasAttribute(name)) host.removeAttribute(name);
    } else {
        const s = String(value);
        if (host.getAttribute(name) !== s) host.setAttribute(name, s);
    }
};

/**
 * Observe HTML attributes, coerce them into props, and optionally reflect prop
 * writes back to the DOM.
 *
 * `config` is a descriptor map (`{ count: { type: Number, reflect: true } }`).
 *
 * @param {Record<string, AttributeDescriptor>} config
 * @returns {Middleware}
 */
export const attributes = config => {
    /** @type {Record<string, AttributeDescriptor>} */
    const map = config;
    const names = Object.keys(map);
    const reflectedKeys = names.filter(name => map[name]?.reflect);

    return Base => {
        const SuperClass =
            /** @type {new (...args: unknown[]) => HTMLElement & { connectedCallback?(): void; disconnectedCallback?(): void }} */ (
                /** @type {unknown} */ (Base)
            );

        return class extends SuperClass {
            /** @type {null | (() => void)} */
            #reflectDispose = null;

            static get observedAttributes() {
                return names;
            }

            attributeChangedCallback(/** @type {string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
                /** @type {SlimHost} */ (/** @type {unknown} */ (this))[name] = coerceIn(map[name]?.type, value);
            }

            connectedCallback() {
                super.connectedCallback?.();

                if (DEV) {
                    for (const name of reflectedKeys) {
                        if (!Object.getOwnPropertyDescriptor(this, name)?.get) {
                            console.warn(
                                `[@slimlib/element] attribute "${name}" is declared reflect: true but was not declared via props(); reflection won't track changes.`
                            );
                        }
                    }
                }

                if (!this.#reflectDispose && reflectedKeys.length > 0) {
                    const disposers = reflectedKeys.map(name => {
                        if (DEV) {
                            // Runaway-loop detector: a non-round-trip-stable custom `type`
                            // reflects → coerces → reflects forever. Count writes within a
                            // single synchronous flush and bail (warn once) past a threshold.
                            let writes = 0;
                            return effect(() => {
                                if (writes > 100) {
                                    if (writes === 101) {
                                        writes = 102;
                                        console.warn(
                                            `[@slimlib/element] attribute "${name}" reflected over 100 times in one flush; its custom "type" is likely not round-trip stable.`
                                        );
                                    }
                                    return;
                                }
                                if (writes++ === 0)
                                    queueMicrotask(() => {
                                        writes = 0;
                                    });
                                reflectOut(/** @type {SlimHost} */ (/** @type {unknown} */ (this)), name, map[name]?.type);
                            }, 1 /* EAGER */);
                        }
                        return effect(
                            () => reflectOut(/** @type {SlimHost} */ (/** @type {unknown} */ (this)), name, map[name]?.type),
                            1 /* EAGER */
                        );
                    });
                    this.#reflectDispose = () => {
                        for (const dispose of disposers) dispose();
                    };
                }
            }

            disconnectedCallback() {
                this.#reflectDispose?.();
                this.#reflectDispose = null;
                super.disconnectedCallback?.();
            }
        };
    };
};
