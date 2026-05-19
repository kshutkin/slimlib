import { activeScope, effect, scope, signal, untracked } from '@slimlib/store';

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
 * Manipulated via inlined `prev = currentOnDispose; currentOnDispose = …` swaps at
 * render(), appendChild() function-child, and forEach() per-item sites; restored in a
 * `finally` block for nesting safety. Cleanup registration is inlined as well:
 * `if (currentOnDispose !== null) currentOnDispose(cb);`.
 *
 * @type {((cb: () => void) => void) | null}
 */
let currentOnDispose = null;

/**
 * Cache of resolved property setters keyed by "tagName,propName". Stored unbound; bound per-call.
 *
 * @type {Map<string, ((value: unknown) => void) | null>}
 */
const propertiesSetterCache = new Map();

/**
 * @param {Element} element
 * @param {string} key
 * @returns {((value: unknown) => void) | null}
 */
const getPropertySetter = (element, key) => {
    const cacheKey = `${element.tagName},${key}`;
    let setter = propertiesSetterCache.get(cacheKey);
    if (setter !== undefined) {
        return setter;
    }
    /** @type {object | null} */
    let prototype = Object.getPrototypeOf(element);
    while (prototype !== null) {
        const desc = Object.getOwnPropertyDescriptor(prototype, key);
        if (desc !== undefined) {
            setter = desc.set !== undefined ? /** @type {(value: unknown) => void} */ (desc.set) : null;
            propertiesSetterCache.set(cacheKey, setter);
            return setter;
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    propertiesSetterCache.set(cacheKey, null);
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
const applyProperty = (element, key, value) => {
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
    const setter = getPropertySetter(element, key);
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
            currentOnDispose?.(() => element.removeEventListener(eventName, listener));
        }
        return;
    }
    if (key === 'ref') {
        if (typeof value === 'function') {
            const refFn = /** @type {(e: Element | null) => void} */ (value);
            refFn(element);
            currentOnDispose?.(() => refFn(null));
        }
        return;
    }
    if (typeof value === 'function') {
        const reactive = /** @type {() => unknown} */ (value);
        // effect() auto-registers with the active store scope.
        effect(() => {
            applyProperty(element, key, reactive());
        });
        return;
    }
    applyProperty(element, key, value);
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
                const prev = currentOnDispose;
                currentOnDispose = onDispose;
                try {
                    insertBefore(parent, child(), end);
                } finally {
                    currentOnDispose = prev;
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

/**
 * Mount JSX into `container`. The first argument must be a function that produces
 * the JSX tree — this ensures reactive bindings are created inside the render scope
 * so they can be torn down on dispose. Returns a dispose function.
 *
 * Reactive bindings inside the tree are scheduled via `@slimlib/store`'s
 * scheduler (default: `queueMicrotask`). The DOM is therefore populated on the
 * next microtask after `render()` returns. To observe the populated DOM
 * synchronously, either drain manually with `flushEffects()` or install a
 * synchronous scheduler via `setScheduler(fn => fn())`.
 *
 * The returned dispose function tears down reactive bindings only — it does
 * **not** remove the inserted DOM nodes from `container`. If you need to
 * unmount the DOM, remove the nodes yourself (e.g. `container.replaceChildren()`
 * or remove the specific nodes) after calling dispose.
 *
 * Usage: `render(() => <App />, document.body)`
 *
 * @param {() => Child} factory
 * @param {Element | DocumentFragment} container
 * @returns {() => void}
 */
export const render = (factory, container) => {
    return scope(onDispose => {
        const prevOnDispose = currentOnDispose;
        currentOnDispose = onDispose;
        try {
            container.appendChild(createElement(factory, null));
        } finally {
            currentOnDispose = prevOnDispose;
        }
    });
};

/**
 * @template T
 * @typedef {{
 *     node: Node,
 *     itemSig: import('@slimlib/store').Signal<T>,
 *     idxSig: import('@slimlib/store').Signal<number>,
 *     dispose: () => void
 * }} Entry
 */

/**
 * Keyed list renderer.
 *
 *   <ul>
 *     {forEach(
 *         () => items(),
 *         (item) => item.id,
 *         (item, index) => <li>{() => item().name}</li>,
 *     )}
 *   </ul>
 *
 * - `each` is read inside an effect; the list reconciles on every change.
 * - `key` MUST return a stable id per logical row.
 * - `body` is called ONCE per item per lifetime; it receives reactive getters
 *   `item()` / `index()` whose values update in place on reorder / value swap.
 * - `body` must return a single DOM Node (typically a JSX element).
 *
 * The returned DocumentFragment carries two comment anchors; the effect
 * inserts / moves / removes item nodes between them. Per-item sub-scopes are
 * children of the surrounding scope, so they tear down on item removal or
 * when the outer scope is disposed.
 *
 * @template T
 * @param {() => readonly T[]} each
 * @param {(item: T, index: number) => string | number} key
 * @param {(item: () => T, index: () => number) => Child} body
 * @returns {DocumentFragment}
 */
export const forEach = (each, key, body) => {
    // Capture the surrounding scope at construction time. The reconciler effect
    // below runs later via the flush queue, at which point `activeScope` is
    // typically undefined — so per-item `scope(...)` calls would otherwise be
    // orphaned (not reachable from any parent) and survive `render()` dispose.
    const parentScope = activeScope;

    const frag = document.createDocumentFragment();
    const start = document.createComment('');
    const end = document.createComment('');
    frag.appendChild(start);
    frag.appendChild(end);

    /** @type {Map<string | number, Entry<T>>} */
    let prevMap = new Map();

    effect(() => {
        const arr = each();
        const len = arr.length;
        /** @type {Map<string | number, Entry<T>>} */
        const newMap = new Map();
        /** @type {(string | number)[]} */
        const newKeys = new Array(len);

        // Reconciliation runs untracked so that signal reads performed by `body`
        // during item construction (and by per-item function-child effects when
        // they first wire up under the outer effect's stack) don't accidentally
        // subscribe the outer effect to per-item signals. Otherwise updating an
        // item via `itemSig.set` from within this run would re-schedule the
        // outer effect — triggering the store's cycle guard.
        untracked(() => {
            for (let i = 0; i < len; i++) {
                const item = /** @type {T} */ (arr[i]);
                const k = key(item, i);
                newKeys[i] = k;
                const existing = prevMap.get(k);
                /** @type {Entry<T>} */
                let entry;
                if (existing !== undefined) {
                    if (!Object.is(existing.itemSig(), item)) existing.itemSig.set(item);
                    if (existing.idxSig() !== i) existing.idxSig.set(i);
                    prevMap.delete(k);
                    entry = existing;
                } else {
                    const itemSig = signal(item);
                    const idxSig = signal(i);
                    /** @type {Node | undefined} */
                    let node;
                    const dispose = scope(onDispose => {
                        // Route non-effect cleanups (on:* listeners, ref(null)) into THIS
                        // sub-scope so they tear down when the item is removed. Without
                        // this, the renderer's module-level dispose register still points
                        // at the surrounding scope and listeners outlive the item.
                        const prev = currentOnDispose;
                        currentOnDispose = onDispose;
                        try {
                            const built = body(itemSig, idxSig);
                            if (!(built instanceof Node)) {
                                throw new Error('forEach: body must return a single Node');
                            }
                            node = built;
                        } finally {
                            currentOnDispose = prev;
                        }
                    }, parentScope);
                    entry = { node: /** @type {Node} */ (node), itemSig, idxSig, dispose };
                }
                newMap.set(k, entry);
            }

            const parent = /** @type {Node} */ (end.parentNode);

            // Remove entries that vanished from the new list.
            for (const entry of prevMap.values()) {
                entry.dispose();
                parent.removeChild(entry.node);
            }

            // Reorder + insert. Walk new order in reverse so each step's anchor
            // (the node that should follow `i`) is already in its final position.
            /** @type {Node} */
            let nextRef = end;
            for (let i = len - 1; i >= 0; i--) {
                const entry = /** @type {Entry<T>} */ (newMap.get(/** @type {string | number} */ (newKeys[i])));
                if (entry.node.nextSibling !== nextRef) {
                    parent.insertBefore(entry.node, nextRef);
                }
                nextRef = entry.node;
            }

            prevMap = newMap;
        });
    });

    return frag;
};
