import { DEV } from 'esm-env';

import { render } from '@slimlib/jsx';
import { state } from '@slimlib/store';

export { attributes, boolAttr, numberAttr, stringAttr } from './middleware/attributes.js';
export { disabledFeatures } from './middleware/disabled-features.js';
export { formAssociated } from './middleware/form-associated.js';
export { onAdopted } from './middleware/on-adopted.js';
export { onMove } from './middleware/on-move.js';
export { withInternals } from './middleware/with-internals.js';

/** @typedef {import('./types.js').SlimHost} SlimHost */
/** @typedef {import('./types.js').SlimRender} SlimRender */
/** @typedef {import('./types.js').Middleware} Middleware */

/** @type {SlimHost | undefined} */
let currentHost;

/**
 * Create an unregistered light-DOM custom element constructor backed by `@slimlib/jsx`.
 *
 * Reactive properties are declared inside the render callback via `props({...})`.
 * Class-time custom element features are composed with middleware.
 *
 * @overload
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
/**
 * @overload
 * @param {Middleware[]} middleware
 * @param {SlimRender} userRender
 * @param {CustomElementConstructor} [ElementBase]
 * @returns {CustomElementConstructor}
 */
/**
 * @param {SlimRender | Middleware[]} middlewareOrRender
 * @param {SlimRender} [maybeRender]
 * @param {CustomElementConstructor} [ElementBase]
 * @returns {CustomElementConstructor}
 */
export const createCustomElement = (middlewareOrRender, maybeRender, ElementBase = HTMLElement) => {
    const hasRenderOnly = typeof middlewareOrRender === 'function' && maybeRender === undefined;
    if (DEV && !hasRenderOnly && !Array.isArray(middlewareOrRender)) {
        throw new Error('createCustomElement: middleware must be an array of (ElementBase) => ElementSubclass functions');
    }
    const userRender = /** @type {SlimRender} */ (hasRenderOnly ? middlewareOrRender : maybeRender);
    const layers = /** @type {Middleware[]} */ (hasRenderOnly ? [] : middlewareOrRender);

    const ElementConstructor = applySlimCore(ElementBase, userRender);
    return layers.reduceRight((currentElementConstructor, layer) => layer(currentElementConstructor), ElementConstructor);
};

/**
 * Define and register an autonomous light-DOM custom element backed by `@slimlib/jsx`.
 *
 * @overload
 * @param {string} tag
 * @param {SlimRender} userRender
 * @returns {void}
 */
/**
 * @overload
 * @param {string} tag
 * @param {Middleware[]} middleware
 * @param {SlimRender} userRender
 * @returns {void}
 */
/**
 * @param {string} tag
 * @param {SlimRender | Middleware[]} middlewareOrRender
 * @param {SlimRender} [maybeRender]
 * @returns {void}
 */
export const defineElement = (tag, middlewareOrRender, maybeRender) => {
    let ElementConstructor = createCustomElement(
        /** @type {Middleware[]} */ (/** @type {unknown} */ (middlewareOrRender)),
        /** @type {SlimRender} */ (maybeRender)
    );
    if (DEV) {
        ElementConstructor = createNamedElementClass(tag, ElementConstructor);
    }

    customElements.define(tag, ElementConstructor);
};

/**
 * Define and register a customized built-in element backed by `@slimlib/jsx`.
 *
 * @overload
 * @param {string} tag
 * @param {string} extendElement
 * @param {SlimRender} userRender
 * @returns {void}
 */
/**
 * @overload
 * @param {string} tag
 * @param {string} extendElement
 * @param {Middleware[]} middleware
 * @param {SlimRender} userRender
 * @returns {void}
 */
/**
 * @param {string} tag
 * @param {string} extendElement
 * @param {SlimRender | Middleware[]} middlewareOrRender
 * @param {SlimRender} [maybeRender]
 * @returns {void}
 */
export const defineBuiltinElement = (tag, extendElement, middlewareOrRender, maybeRender) => {
    const ElementBase = /** @type {CustomElementConstructor} */ (/** @type {unknown} */ (document.createElement(extendElement).constructor));
    let ElementConstructor = createCustomElement(
        /** @type {Middleware[]} */ (/** @type {unknown} */ (middlewareOrRender)),
        /** @type {SlimRender} */ (maybeRender),
        ElementBase
    );
    if (DEV) {
        ElementConstructor = createNamedElementClass(tag, ElementConstructor);
    }

    customElements.define(tag, ElementConstructor, { extends: extendElement });
};

/**
 * @param {string} tag
 * @param {CustomElementConstructor} ElementBase
 * @returns {CustomElementConstructor}
 */
const createNamedElementClass = (tag, ElementBase) => {
    const className = tag.replace(/(^|-)(\w)/g, (_match, _separator, character) => character.toUpperCase());
    return /** @type {CustomElementConstructor} */ ({ [className]: class extends ElementBase {} }[className]);
};

/**
 * @param {CustomElementConstructor} ElementBase
 * @param {SlimRender} userRender
 * @returns {CustomElementConstructor}
 */
const applySlimCore = (ElementBase, userRender) =>
    class extends ElementBase {
        #mounted = false;
        /** @type {null | (() => void)} */
        #disposeRender = null;

        connectedCallback() {
            if (!this.#mounted) {
                this.#mounted = true;
                const previousHost = currentHost;
                currentHost = /** @type {SlimHost} */ (/** @type {unknown} */ (this));
                this.#disposeRender = render(
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
                this.#disposeRender?.();
                this.#disposeRender = null;
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
 * @template {Record<string, unknown>} Props
 * @param {Props} initialProps
 * @returns {Props}
 */
export const props = initialProps => {
    if (DEV && currentHost === undefined) {
        throw new Error('props() must be called synchronously inside a defineElement render callback');
    }
    const reactiveProps = /** @type {Props} */ (state(initialProps));
    for (const propertyName of Object.keys(initialProps)) {
        if (Object.hasOwn(/** @type {SlimHost} */ (currentHost), propertyName)) {
            /** @type {Record<string, unknown>} */ (reactiveProps)[propertyName] = /** @type {SlimHost} */ (currentHost)[propertyName];
            delete (/** @type {SlimHost} */ (currentHost)[propertyName]);
        }
        Object.defineProperty(/** @type {SlimHost} */ (currentHost), propertyName, {
            configurable: true,
            enumerable: true,
            get() {
                return reactiveProps[propertyName];
            },
            set(propertyValue) {
                /** @type {Record<string, unknown>} */ (reactiveProps)[propertyName] = propertyValue;
            },
        });
    }
    return reactiveProps;
};
