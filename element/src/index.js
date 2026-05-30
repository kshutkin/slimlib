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
import { createList, emit, RENDER_GEN } from './utils/pubsub.js';

export { attributes, boolAttr, numberAttr, stringAttr } from './middleware/attributes.js';
export { disabledFeatures } from './middleware/disabled-features.js';
export { formAssociated } from './middleware/form-associated.js';
export { onAdopted } from './middleware/on-adopted.js';
export { onMove } from './middleware/on-move.js';
export { withInternals } from './middleware/with-internals.js';

/** @typedef {import('./types.js').SlimHost} SlimHost */
/** @typedef {import('./types.js').SlimRender} SlimRender */
/** @typedef {import('./types.js').Middleware} Middleware */
/** @typedef {ReturnType<Parameters<typeof render>[0]>} JsxChild */
/** @typedef {(...args: unknown[]) => void} LifecycleListener */

/** @type {SlimHost | undefined} */
let currentHost;

// DEV-only cross-instance detection. A render-time listener is stamped with a
// WeakRef to the host it was registered on, so a shared/long-lived function
// identity never retains the component (the ref stays weak and the host can be
// collected). Re-registering the same identity on a different instance is the
// unsupported case and is warned about (the per-list generation tag lives on
// the function, so cross-instance reuse breaks).
const OWNER = Symbol();

/** @typedef {SlimHost & Record<symbol, LifecycleListener[]> & Record<typeof RENDER_GEN, number>} LifecycleHost */

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
        [RENDER_GEN] = 0;

        connectedCallback() {
            if (!this.#mounted) {
                this.#mounted = true;
                const previousHost = currentHost;
                currentHost = /** @type {SlimHost} */ (/** @type {unknown} */ (this));
                this.#disposeRender = render(
                    () => /** @type {JsxChild} */ (userRender(/** @type {SlimHost} */ (/** @type {unknown} */ (this)))),
                    this
                );
                currentHost = previousHost;
                emit(/** @type {LifecycleHost} */ (this), MOUNT);
            }
            emit(/** @type {LifecycleHost} */ (this), CONNECT);
        }

        async disconnectedCallback() {
            emit(/** @type {LifecycleHost} */ (this), DISCONNECT);
            await Promise.resolve();
            if (!this.isConnected && this.#mounted) {
                this.#mounted = false;
                emit(/** @type {LifecycleHost} */ (this), UNMOUNT);
                this.#disposeRender?.();
                this.#disposeRender = null;
                /** @type {LifecycleHost} */ (this)[RENDER_GEN]++;
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
 * Render-time listeners are tagged with the current render generation and become
 * stale (lazily dropped) once the element genuinely unmounts and the generation
 * advances, so re-renders register fresh listeners without leaking old ones.
 * Subscribing to the same message during an emit is unsupported.
 *
 * @param {symbol} key
 * @template {unknown[]} Args
 * @param {(...args: Args) => void} listener
 * @returns {void}
 */
const subscribeToLifecycle = (key, listener) => {
    if (DEV && currentHost === undefined) {
        throw new Error('lifecycle subscriptions must be called synchronously inside a defineElement render callback');
    }
    if (DEV && !(key in /** @type {LifecycleHost} */ (currentHost))) {
        console.warn(
            '[@slimlib/element] lifecycle subscription ignored: this element does not implement the requested lifecycle. Add the matching middleware before subscribing to optional lifecycle callbacks.'
        );
        return;
    }
    const list = /** @type {LifecycleListener[]} */ (/** @type {LifecycleHost} */ (currentHost)[key]);
    const taggedListener = /** @type {Record<symbol, number | undefined>} */ (/** @type {unknown} */ (listener));
    if (DEV) {
        const ownerView = /** @type {Record<symbol, WeakRef<SlimHost> | undefined>} */ (/** @type {unknown} */ (listener));
        const previous = ownerView[OWNER];
        if (previous !== undefined && previous.deref() !== currentHost) {
            console.warn(
                '[@slimlib/element] the same listener function was subscribed on more than one element instance; render-time subscriptions must use a distinct function per instance.'
            );
        }
        ownerView[OWNER] = new WeakRef(/** @type {SlimHost} */ (currentHost));
    }
    // The list's own symbol doubles as the per-list generation tag on the
    // listener, so a re-subscribed identity refreshes its existing slot in this
    // list (no duplicate) while staying independent across other lists. The tag
    // lives on the function, so the same identity registered on two different
    // host instances for the same key is unsupported (use a distinct function
    // per instance); render closures are distinct, so this is a non-issue.
    if (taggedListener[key] === undefined) {
        list.push(/** @type {LifecycleListener} */ (/** @type {unknown} */ (listener)));
    }
    taggedListener[key] = /** @type {LifecycleHost} */ (currentHost)[RENDER_GEN];
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
    const host = currentHost;
    subscribeToLifecycle(MOUNT, () => {
        const cleanup = listener();
        if (typeof cleanup === 'function') {
            const list = /** @type {LifecycleListener[]} */ (/** @type {LifecycleHost} */ (host)[UNMOUNT]);
            const taggedCleanup = /** @type {Record<symbol, number | undefined>} */ (/** @type {unknown} */ (cleanup));
            if (DEV) {
                const ownerView = /** @type {Record<symbol, WeakRef<SlimHost> | undefined>} */ (/** @type {unknown} */ (cleanup));
                const previous = ownerView[OWNER];
                if (previous !== undefined && previous.deref() !== host) {
                    console.warn(
                        '[@slimlib/element] the same listener function was subscribed on more than one element instance; render-time subscriptions must use a distinct function per instance.'
                    );
                }
                ownerView[OWNER] = new WeakRef(/** @type {SlimHost} */ (host));
            }
            if (taggedCleanup[UNMOUNT] === undefined) {
                list.push(/** @type {LifecycleListener} */ (/** @type {unknown} */ (cleanup)));
            }
            taggedCleanup[UNMOUNT] = /** @type {LifecycleHost} */ (host)[RENDER_GEN];
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
