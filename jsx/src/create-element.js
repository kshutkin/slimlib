import { effect, scope } from '@slimlib/store';

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
 * @param {Element} el
 * @param {string} key
 * @returns {((value: unknown) => void) | null}
 */
const getPropSetter = (el, key) => {
    const cacheKey = `${el.tagName},${key}`;
    let setter = propSetterCache.get(cacheKey);
    if (setter !== undefined) return setter;
    /** @type {object | null} */
    let proto = Object.getPrototypeOf(el);
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
 * @param {Element} el
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
const applyProp = (el, key, value) => {
    if (key.startsWith('prop:')) {
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (el))[key.slice(5)] = value;
        return;
    }
    if (key.startsWith('attr:')) {
        const k = key.slice(5);
        if (value === false || value == null) el.removeAttribute(k);
        else el.setAttribute(k, value === true ? '' : String(value));
        return;
    }
    const setter = getPropSetter(el, key);
    if (setter !== null) {
        setter.call(el, value);
    } else if (value === false || value == null) {
        el.removeAttribute(key);
    } else {
        el.setAttribute(key, value === true ? '' : String(value));
    }
};

/**
 * Set a prop, wiring up reactivity when value is a function.
 *
 * @param {Element} el
 * @param {string} key
 * @param {unknown} value
 * @returns {void}
 */
const setProp = (el, key, value) => {
    if (key.startsWith('on:')) {
        const eventName = key.slice(3);
        if (typeof value === 'function') {
            const listener = /** @type {EventListener} */ (value);
            el.addEventListener(eventName, listener);
            registerCleanup(() => el.removeEventListener(eventName, listener));
        }
        return;
    }
    if (key === 'ref') {
        if (typeof value === 'function') {
            const refFn = /** @type {(e: Element | null) => void} */ (value);
            refFn(el);
            registerCleanup(() => refFn(null));
        }
        return;
    }
    if (typeof value === 'function') {
        const reactive = /** @type {() => unknown} */ (value);
        // effect() auto-registers with the active store scope.
        effect(() => {
            applyProp(el, key, reactive());
        });
        return;
    }
    applyProp(el, key, value);
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
        for (let i = 0; i < child.length; i++) appendChild(parent, child[i]);
        return;
    }
    if (typeof child === 'function') {
        const start = document.createComment('');
        const end = document.createComment('');
        parent.appendChild(start);
        parent.appendChild(end);
        // Each re-render gets its own child scope so effects, on:* listeners,
        // and ref(null) cleanups registered by the previous subtree are disposed
        // when the function-child swaps content. The effect cleanup disposes the
        // sub-scope before each re-run and on final disposal.
        /** @type {() => void} */
        let sub;
        effect(() => {
            let n = start.nextSibling;
            while (n !== null && n !== end) {
                const nx = n.nextSibling;
                parent.removeChild(n);
                n = nx;
            }
            sub = scope(onDispose => {
                const prev = setOnDispose(onDispose);
                try {
                    insertBefore(parent, child(), end);
                } finally {
                    setOnDispose(prev);
                }
            });
            return () => sub();
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
        for (let i = 0; i < child.length; i++) insertBefore(parent, child[i], anchor);
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
 * Build a Node for a JSX element. Uses module-level scope state.
 *
 * @template {Props} P
 * @param {ElementType<P>} type
 * @param {P | null} props
 * @param {...Child} children
 * @returns {Node}
 */
export const createElement = (type, props, ...children) => {
    if (typeof type === 'function') {
        // Inject children into props only when present; avoid spread allocation otherwise.
        /** @type {Props} */
        const compProps =
            children.length === 0
                ? /** @type {Props} */ (props ?? {})
                : /** @type {Props} */ ({
                      .../** @type {Props} */ (props ?? {}),
                      children: children.length === 1 ? children[0] : children,
                  });
        const result = /** @type {Component<Props>} */ (type)(compProps);
        // Fast path: component returned a single Node — no fragment wrapping needed.
        if (result instanceof Node) return result;
        // Fallback for primitives / arrays / function-children: wrap in a fragment.
        const frag = document.createDocumentFragment();
        appendChild(frag, result);
        return frag;
    }
    const el = document.createElement(type);
    if (props !== null) {
        for (const k in props) {
            if (k === 'children') continue;
            setProp(el, k, /** @type {Record<string, unknown>} */ (props)[k]);
        }
    }
    for (let i = 0; i < children.length; i++) appendChild(el, children[i]);
    return el;
};
