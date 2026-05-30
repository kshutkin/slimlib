import { DEV } from 'esm-env';

import { render } from '@slimlib/jsx';
import { state } from '@slimlib/store';

import {
    ADOPTED,
    CONNECT,
    DISCONNECT,
    FORM_ASSOCIATED,
    FORM_DISABLED,
    FORM_RESET,
    FORM_STATE_RESTORE,
    MOUNT,
    MOVE,
    UNMOUNT,
} from './lifecycle.js';
import { createList, emit, on } from './utils/pubsub.js';

export {
    ADOPTED,
    CONNECT,
    DISCONNECT,
    FORM_ASSOCIATED,
    FORM_DISABLED,
    FORM_RESET,
    FORM_STATE_RESTORE,
    MOUNT,
    MOVE,
    UNMOUNT,
} from './lifecycle.js';
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

/** Host-scoped key for the list of render-time unsubscribe fns, cleared on unmount. */
const RENDER_SUBS = Symbol();

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
    const ElementBase = /** @type {CustomElementConstructor} */ (
        /** @type {unknown} */ (document.createElement(extendElement).constructor)
    );
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

        [MOUNT] = createList();
        [UNMOUNT] = createList();
        [CONNECT] = createList();
        [DISCONNECT] = createList();
        [RENDER_SUBS] = createList();

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
                emit(this[MOUNT]);
            }
            emit(this[CONNECT]);
        }

        async disconnectedCallback() {
            emit(this[DISCONNECT]);
            await Promise.resolve();
            if (!this.isConnected && this.#mounted) {
                this.#mounted = false;
                emit(this[UNMOUNT]);
                this.#disposeRender?.();
                this.#disposeRender = null;
                const renderSubs = /** @type {(() => void)[]} */ (/** @type {any} */ (this)[RENDER_SUBS]);
                for (let index = 0; index < renderSubs.length; index++) {
                    /** @type {(() => void)} */ (renderSubs[index])();
                }
                renderSubs.length = 0;
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

/**
 * Subscribe to a lifecycle message on the current slim element.
 *
 * Must be called synchronously inside a render callback (like `props`).
 * Listeners are dropped automatically on unmount and re-registered when the
 * element re-renders. Subscribing to the same message during an emit is
 * unsupported.
 *
 * @param {symbol} key
 * @param {(...args: any[]) => void} listener
 * @returns {void}
 */
const subscribeToLifecycle = (key, listener) => {
    if (DEV && currentHost === undefined) {
        throw new Error('lifecycle subscriptions must be called synchronously inside a defineElement render callback');
    }
    const host = /** @type {SlimHost} */ (currentHost);
    if (DEV && !(key in host)) {
        console.warn(
            '[@slimlib/element] lifecycle subscription ignored: this element does not implement the requested lifecycle. Add the matching middleware before subscribing to optional lifecycle callbacks.'
        );
        return;
    }
    const off = on(/** @type {any} */ (host)[key], listener);
    const renderSubs = /** @type {(() => void)[]} */ (/** @type {any} */ (host)[RENDER_SUBS]);
    renderSubs.push(off);
};

/**
 * Subscribe to the element's first/genuine mount (fires once per mounted period,
 * after the render callback has run). The listener may return cleanup that runs
 * on the matching genuine unmount.
 *
 * @param {() => void | (() => void)} listener
 * @returns {void}
 */
export const onMount = listener => {
    const host = /** @type {SlimHost} */ (currentHost);
    subscribeToLifecycle(MOUNT, () => {
        const cleanup = listener();
        if (typeof cleanup === 'function') {
            const off = on(/** @type {any} */ (host)[UNMOUNT], cleanup);
            const renderSubs = /** @type {(() => void)[]} */ (/** @type {any} */ (host)[RENDER_SUBS]);
            renderSubs.push(off);
        }
    });
};

/**
 * Subscribe to every connect, including synchronous moves.
 *
 * @param {() => void} listener
 * @returns {void}
 */
export const onConnect = listener => subscribeToLifecycle(CONNECT, listener);

/**
 * Subscribe to the element's genuine disconnect.
 *
 * @param {() => void} listener
 * @returns {void}
 */
export const onDisconnect = listener => subscribeToLifecycle(DISCONNECT, listener);

/**
 * Subscribe to `adoptedCallback` events emitted by `onAdopted()` middleware.
 *
 * @param {(oldDocument: Document, newDocument: Document) => void} listener
 * @returns {void}
 */
export const onAdoptedCallback = listener => subscribeToLifecycle(ADOPTED, listener);

/**
 * Subscribe to `connectedMoveCallback` events emitted by `onMove()` middleware.
 *
 * @param {() => void} listener
 * @returns {void}
 */
export const onConnectedMove = listener => subscribeToLifecycle(MOVE, listener);

/**
 * Subscribe to form owner changes emitted by `formAssociated()` middleware.
 *
 * @param {(form: HTMLFormElement | null) => void} listener
 * @returns {void}
 */
export const onFormAssociated = listener => subscribeToLifecycle(FORM_ASSOCIATED, listener);

/**
 * Subscribe to disabled state changes emitted by `formAssociated()` middleware.
 *
 * @param {(isDisabled: boolean) => void} listener
 * @returns {void}
 */
export const onFormDisabled = listener => subscribeToLifecycle(FORM_DISABLED, listener);

/**
 * Subscribe to form reset events emitted by `formAssociated()` middleware.
 *
 * @param {() => void} listener
 * @returns {void}
 */
export const onFormReset = listener => subscribeToLifecycle(FORM_RESET, listener);

/**
 * Subscribe to form state restore events emitted by `formAssociated()` middleware.
 *
 * @param {(state: unknown, mode: string) => void} listener
 * @returns {void}
 */
export const onFormStateRestore = listener => subscribeToLifecycle(FORM_STATE_RESTORE, listener);
