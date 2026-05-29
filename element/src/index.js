import { DEV } from 'esm-env';

import { render } from '@slimlib/jsx';
import { state } from '@slimlib/store';

export { disabledFeatures } from './middleware/disabled-features.js';
export { formAssociated } from './middleware/form-associated.js';
export { observedAttributes } from './middleware/observed-attributes.js';
export { onAdopted } from './middleware/on-adopted.js';
export { onMove } from './middleware/on-move.js';
export { withInternals } from './middleware/with-internals.js';

/** @typedef {import('./types.js').SlimHost} SlimHost */
/** @typedef {import('./types.js').SlimRender} SlimRender */
/** @typedef {import('./types.js').Middleware} Middleware */

/** @type {SlimHost | undefined} */
let currentHost;

/**
 * Define and register a light-DOM custom element backed by `@slimlib/jsx`.
 *
 * Reactive properties are declared inside the render callback via `props({...})`.
 * Class-time custom element features are composed with middleware.
 *
 * @overload
 * @param {string} tag
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
/**
 * @overload
 * @param {string} tag
 * @param {Middleware[]} middleware
 * @param {SlimRender} userRender
 * @param {string} [extendElement]
 * @returns {CustomElementConstructor}
 */
/**
 * @param {string} tag
 * @param {SlimRender | Middleware[]} middlewareOrRender
 * @param {SlimRender} [maybeRender]
 * @param {string} [extendElement]
 * @returns {CustomElementConstructor}
 */
export const defineElement = (tag, middlewareOrRender, maybeRender, extendElement) => {
    const hasRenderOnly = typeof middlewareOrRender === 'function' && maybeRender === undefined;
    if (DEV && !hasRenderOnly && !Array.isArray(middlewareOrRender)) {
        throw new Error('defineElement: middleware must be an array of (Base) => SubClass functions');
    }
    const userRender = /** @type {SlimRender} */ (hasRenderOnly ? middlewareOrRender : maybeRender);
    const layers = /** @type {Middleware[]} */ (hasRenderOnly ? [] : middlewareOrRender);

    const Base = extendElement
        ? /** @type {CustomElementConstructor} */ (/** @type {unknown} */ (document.createElement(extendElement).constructor))
        : HTMLElement;
    let Ctor = applySlimCore(Base, userRender);
    Ctor = layers.reduceRight((acc, layer) => layer(acc), Ctor);
    if (DEV) Ctor = createNamedElementClass(tag, Ctor);

    customElements.define(tag, Ctor, extendElement ? { extends: extendElement } : undefined);
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
 * @param {CustomElementConstructor} Base
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
const applySlimCore = (Base, userRender) =>
    class extends Base {
        #mounted = false;
        /** @type {null | (() => void)} */
        #dispose = null;

        attributeChangedCallback(/** @type {string} */ name, /** @type {string | null} */ _old, /** @type {string | null} */ value) {
            /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (this))[name] = value;
        }

        connectedCallback() {
            if (!this.#mounted) {
                this.#mounted = true;
                const previousHost = currentHost;
                currentHost = /** @type {SlimHost} */ (/** @type {unknown} */ (this));
                this.#dispose = render(
                    () => /** @type {any} */ (userRender(/** @type {SlimHost} */ (/** @type {unknown} */ (this)))),
                    this
                );
                currentHost = previousHost;
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
 * Declare JS-only reactive properties on the current slim element instance.
 *
 * Must be called synchronously inside a `defineElement` render callback.
 * Returns the underlying `state()` proxy so render code can use it directly
 * (`reactiveProps.count++`) while external code goes through the installed
 * `host.count` accessor. Adopts any own property already on the host (e.g.
 * from `attributeChangedCallback` or a pre-define `el.count = …`).
 *
 * @template {Record<string, unknown>} P
 * @param {P} initialProps
 * @returns {P}
 */
export const props = initialProps => {
    if (DEV && currentHost === undefined) {
        throw new Error('props() must be called synchronously inside a defineElement render callback');
    }
    const reactiveProps = /** @type {P} */ (state(initialProps));
    for (const key of Object.keys(initialProps)) {
        if (Object.hasOwn(/** @type {SlimHost} */ (currentHost), key)) {
            /** @type {Record<string, unknown>} */ (reactiveProps)[key] = /** @type {SlimHost} */ (currentHost)[key];
            delete (/** @type {SlimHost} */ (currentHost)[key]);
        }
        Object.defineProperty(/** @type {SlimHost} */ (currentHost), key, {
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
