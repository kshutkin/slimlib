import { activeScope, effect, scope } from '@slimlib/store';

/** @typedef {import('./types.js').Child} Child */
/** @typedef {import('./types.js').Primitive} Primitive */
/** @typedef {import('./types.js').Props} Props */
/**
 * @template {Props} [P=Props]
 * @typedef {import('./types.js').Component<P>} Component
 */
/**
 * @template {Props} [P=Props]
 * @typedef {import('./types.js').ElementType<P>} ElementType
 */

/**
 * Fragment is a no-op component that simply returns its children.
 * No special-case in the renderer; treated as any other component.
 *
 * @type {Component<{ children?: Child }>}
 */
export const Fragment = props => props.children;

/**
 * Module-level "current dispose register". `render()` sets this before building the tree
 * and clears it after. Non-effect cleanups (ref-null callbacks, event listener removal)
 * register through here. Effects register with the active store scope automatically.
 *
 * @type {((cb: () => void) => void) | null}
 */
let currentOnDispose = null;

/**
 * Internal: set the current dispose register; returns the previous one (for nesting).
 *
 * @param {((cb: () => void) => void) | null} cb
 * @returns {((cb: () => void) => void) | null}
 */
export const setOnDispose = cb => {
    const prev = currentOnDispose;
    currentOnDispose = cb;
    return prev;
};

/**
 * @param {() => void} cb
 * @returns {void}
 */
const registerCleanup = cb => {
    if (currentOnDispose !== null) currentOnDispose(cb);
};

/**
 * Cache of resolved property setters keyed by "tagName,propName". Stored unbound; bound per-call.
 *
 * @type {Map<string, ((value: unknown) => void) | null>}
 */
const propSetterCache = new Map();

/**
 * @param {Element} element
 * @param {string} key
 * @returns {((value: unknown) => void) | null}
 */
const getPropSetter = (element, key) => {
    const cacheKey = `${element.tagName},${key}`;
    let setter = propSetterCache.get(cacheKey);
    if (setter !== undefined) return setter;
    /** @type {object | null} */
    let proto = Object.getPrototypeOf(element);
    while (proto !== null) {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc !== undefined) {
            setter = desc.set !== undefined ? /** @type {(value: unknown) => void} */ (desc.set) : null;
            propSetterCache.set(cacheKey, setter);
            return setter;
        }
        proto = Object.getPrototypeOf(proto);
    }
    propSetterCache.set(cacheKey, null);
    return null;
};

/**
 * Apply a single prop value (static).
 *
 * @param {Element} element
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
const applyProp = (element, key, value) => {
    if (key.startsWith('prop:')) {
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (element))[key.slice(5)] = value;
        return;
    }
    if (key.startsWith('attr:')) {
        const k = key.slice(5);
        if (value === false || value == null) element.removeAttribute(k);
        else element.setAttribute(k, value === true ? '' : String(value));
        return;
    }
    const setter = getPropSetter(element, key);
    if (setter !== null) {
        setter.call(element, value);
    } else if (value === false || value == null) {
        element.removeAttribute(key);
    } else {
        element.setAttribute(key, value === true ? '' : String(value));
    }
};

/**
 * Set a prop, wiring up reactivity when value is a function.
 *
 * @param {Element} element
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
const setProp = (element, key, value) => {
    if (key.startsWith('on:')) {
        const eventName = key.slice(3);
        if (typeof value === 'function') {
            const listener = /** @type {EventListener} */ (value);
            element.addEventListener(eventName, listener);
            registerCleanup(() => element.removeEventListener(eventName, listener));
        }
        return;
    }
    if (key === 'ref') {
        if (typeof value === 'function') {
            const refFn = /** @type {(e: Element | null) => void} */ (value);
            refFn(element);
            registerCleanup(() => refFn(null));
        }
        return;
    }
    if (typeof value === 'function') {
        const reactive = /** @type {() => unknown} */ (value);
        // effect() auto-registers with the active store scope.
        effect(() => {
            applyProp(element, key, reactive());
        });
        return;
    }
    applyProp(element, key, value);
};

/**
 * Append a Child into a parent Node, creating reactive bindings as needed.
 *
 * @param {Node} parent
 * @param {Child} child
 * @returns {void}
 */
const appendChild = (parent, child) => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
        for (let i = 0; i < child.length; ++i) {
            appendChild(parent, child[i]);
        }
        return;
    }
    if (typeof child === 'function') {
        const start = document.createComment('');
        const end = document.createComment('');
        parent.appendChild(start);
        parent.appendChild(end);
        // Capture the surrounding scope at setup time. The effect below runs
        // later via the flush queue, when `activeScope` is typically undefined —
        // so the sub-scope created below would otherwise be orphaned.
        const parentScope = activeScope;
        // Each re-render gets its own child scope so effects, on:* listeners,
        // and ref(null) cleanups registered by the previous subtree are disposed
        // when the function-child swaps content. The effect cleanup disposes the
        // sub-scope before each re-run and on final disposal.
        /** @type {import('@slimlib/store').Scope} */
        let scopeInstance;
        effect(() => {
            let nextSibling = start.nextSibling;
            // `end` is always reached before the sibling chain runs out, so no
            // null guard is needed (start and end live in `parent` together).
            while (nextSibling !== end) {
                const nextNextSibling = /** @type {ChildNode} */ (nextSibling).nextSibling;
                parent.removeChild(/** @type {ChildNode} */ (nextSibling));
                nextSibling = nextNextSibling;
            }
            scopeInstance = scope(onDispose => {
                const prev = setOnDispose(onDispose);
                try {
                    insertBefore(parent, child(), end);
                } finally {
                    setOnDispose(prev);
                }
            }, parentScope);
            return () => scopeInstance();
        });
        return;
    }
    if (child instanceof Node) {
        parent.appendChild(child);
        return;
    }
    parent.appendChild(document.createTextNode(String(/** @type {Primitive} */ (child))));
};

/**
 * Insert a Child immediately before `anchor`.
 *
 * @param {Node} parent
 * @param {Child} child
 * @param {Node} anchor
 * @returns {void}
 */
const insertBefore = (parent, child, anchor) => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
        for (let i = 0; i < child.length; ++i) {
            insertBefore(parent, child[i], anchor);
        }
        return;
    }
    if (child instanceof Node) {
        parent.insertBefore(child, anchor);
        return;
    }
    if (typeof child === 'function') {
        // One-shot eager evaluation: a function-child returning another function
        // is unwrapped here without creating an effect. No re-runs → no leak,
        // so no sub-scope is needed. The outer effect (set up by appendChild)
        // owns reactivity for this slot.
        insertBefore(parent, child(), anchor);
        return;
    }
    parent.insertBefore(document.createTextNode(String(/** @type {Primitive} */ (child))), anchor);
};

/**
 * Internal: build a Node from an already-arrayed children list. Shared by both
 * the public varargs `createElement` and the JSX automatic-runtime entry points
 * (`jsx` / `jsxs`) to avoid the array → spread → rest → array roundtrip.
 *
 * @template {Props} P
 * @param {ElementType<P>} type
 * @param {P | null} props
 * @param {readonly Child[]} children
 * @returns {Node}
 */
export const createElementArray = (type, props, children) => {
    const childrenLength = children.length;
    if (typeof type === 'function') {
        // Inject children into props only when present; avoid spread allocation otherwise.
        /** @type {Props} */
        const compProps =
            childrenLength === 0
                ? /** @type {Props} */ (props ?? {})
                : /** @type {Props} */ ({
                      .../** @type {Props} */ (props),
                      children: childrenLength === 1 ? children[0] : children,
                  });
        const result = /** @type {Component<Props>} */ (type)(compProps);
        // Fast path: component returned a single Node — no fragment wrapping needed.
        if (result instanceof Node) {
            return result;
        }
        // Fallback for primitives / arrays / function-children: wrap in a fragment.
        const fragment = document.createDocumentFragment();
        appendChild(fragment, result);
        return fragment;
    }
    const element = document.createElement(type);
    for (const key in props) {
        setProp(element, key, /** @type {Record<string, unknown>} */ (props)[key]);
    }
    for (let i = 0; i < childrenLength; ++i) {
        appendChild(element, children[i]);
    }
    return element;
};

/**
 * Build a Node for a JSX element (classic varargs signature).
 *
 * @template {Props} P
 * @param {ElementType<P>} type
 * @param {P | null} props
 * @param {...Child} children
 * @returns {Node}
 */
export const createElement = (type, props, ...children) => createElementArray(type, props, children);
