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
 * @typedef {(Base: CustomElementConstructor) => CustomElementConstructor} Middleware
 */

/**
 * @typedef {object} FormAssociatedHandlers
 * @property {(host: SlimHost, form: HTMLFormElement | null) => void} [associated]
 * @property {(host: SlimHost, disabled: boolean) => void} [disabled]
 * @property {(host: SlimHost) => void} [reset]
 * @property {(host: SlimHost, state: unknown, mode: string) => void} [stateRestore]
 */

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
 * @param {string[]} attrs
 * @returns {Middleware}
 */
export const observedAttributes = attrs => Base =>
    class extends Base {
        static get observedAttributes() {
            return attrs;
        }
    };

/**
 * @param {string[]} features
 * @returns {Middleware}
 */
export const disabledFeatures = features => Base =>
    class extends Base {
        static disabledFeatures = features;
    };

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

/**
 * @returns {Middleware}
 */
export const withInternals = () => Base =>
    class extends Base {
        constructor() {
            super();
            /** @type {SlimHost & { _internals: ElementInternals }} */ (/** @type {unknown} */ (this))._internals = this.attachInternals();
        }
    };

/**
 * @param {(host: SlimHost, oldDoc: Document, newDoc: Document) => void} fn
 * @returns {Middleware}
 */
export const onAdopted = fn => Base =>
    class extends Base {
        adoptedCallback(/** @type {Document} */ oldDoc, /** @type {Document} */ newDoc) {
            fn(/** @type {SlimHost} */ (/** @type {unknown} */ (this)), oldDoc, newDoc);
        }
    };

/**
 * @param {(host: SlimHost) => void} fn
 * @returns {Middleware}
 */
export const onMove = fn => Base =>
    class extends Base {
        connectedMoveCallback() {
            fn(/** @type {SlimHost} */ (/** @type {unknown} */ (this)));
        }
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
