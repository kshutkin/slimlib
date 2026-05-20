import { activeScope, effect, scope, signal, untracked } from '@slimlib/store';
import { DEV } from 'esm-env';

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
    } else if (key.startsWith('attr:')) {
        const k = key.slice(5);
        if (value === false || value == null) element.removeAttribute(k);
        else element.setAttribute(k, value === true ? '' : String(value));
    } else {
        const setter = getPropertySetter(element, key);
        if (setter !== null) setter.call(element, value);
        else if (value === false || value == null) element.removeAttribute(key);
        else element.setAttribute(key, value === true ? '' : String(value));
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
const setProperty = (element, key, value) => {
    if (key.startsWith('on:')) {
        const eventName = key.slice(3);
        if (typeof value === 'function') {
            const listener = /** @type {EventListener} */ (value);
            element.addEventListener(eventName, listener);
            currentOnDispose?.(() => element.removeEventListener(eventName, listener));
        }
    } else if (key === 'ref') {
        if (typeof value === 'function') {
            const refFn = /** @type {(e: Element | null) => void} */ (value);
            refFn(element);
            currentOnDispose?.(() => refFn(null));
        }
    } else if (typeof value === 'function') {
        const reactive = /** @type {() => unknown} */ (value);
        // effect() auto-registers with the active store scope.
        effect(() => {
            applyProperty(element, key, reactive());
        });
    } else {
        applyProperty(element, key, value);
    }
};

/**
 * Append a Child into a parent Node, creating reactive bindings as needed.
 *
 * @param {Node} parent
 * @param {Child} child
 * @returns {void}
 */
const appendChild = (parent, child) => {
    if (child == null || child === false || child === true) {
        // skip
    } else if (Array.isArray(child)) {
        for (let i = 0; i < child.length; ++i) {
            appendChild(parent, child[i]);
        }
    } else if (typeof child === 'function') {
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
        /** @type {import('@slimlib/store').Scope | undefined} */
        let scopeInstance;
        // Fast path: when the function-child resolves to a primitive we keep a
        // single Text node across re-runs and mutate `.data` in place instead
        // of paying for removeChild + createTextNode + insertBefore.
        /** @type {Text | null} */
        let textNode = null;
        effect(() => {
            let value;
            /** @type {import('@slimlib/store').Scope} */
            const newScope = scope(onDispose => {
                const prev = currentOnDispose;
                currentOnDispose = onDispose;
                try {
                    value = child();
                } finally {
                    currentOnDispose = prev;
                }
            }, parentScope);
            const isPrimitive =
                value != null &&
                value !== false &&
                value !== true &&
                typeof value !== 'object' &&
                typeof value !== 'function';
            if (isPrimitive && textNode !== null) {
                // Text fast path: reuse existing node, no DOM thrash.
                const str = String(value);
                if (textNode.data !== str) textNode.data = str;
                newScope();
                return;
            }
            // Slow path: dispose previous scope + clear sibling range.
            if (scopeInstance !== undefined) scopeInstance();
            let nextSibling = start.nextSibling;
            while (nextSibling !== end) {
                const nextNextSibling = /** @type {ChildNode} */ (nextSibling).nextSibling;
                parent.removeChild(/** @type {ChildNode} */ (nextSibling));
                nextSibling = nextNextSibling;
            }
            if (isPrimitive) {
                textNode = document.createTextNode(String(/** @type {Primitive} */ (value)));
                parent.insertBefore(textNode, end);
                newScope();
                scopeInstance = undefined;
            } else {
                textNode = null;
                scopeInstance = newScope;
                insertBefore(parent, value, end);
            }
            return () => {
                if (scopeInstance !== undefined) {
                    const s = scopeInstance;
                    scopeInstance = undefined;
                    s();
                }
            };
        });
    } else if (child instanceof Node) {
        parent.appendChild(child);
    } else {
        parent.appendChild(document.createTextNode(String(/** @type {Primitive} */ (child))));
    }
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
    if (child == null || child === false || child === true) {
        // skip
    } else if (Array.isArray(child)) {
        for (let i = 0; i < child.length; ++i) {
            insertBefore(parent, child[i], anchor);
        }
    } else if (child instanceof Node) {
        parent.insertBefore(child, anchor);
    } else if (typeof child === 'function') {
        // One-shot eager evaluation: a function-child returning another function
        // is unwrapped here without creating an effect. No re-runs → no leak,
        // so no sub-scope is needed. The outer effect (set up by appendChild)
        // owns reactivity for this slot.
        insertBefore(parent, child(), anchor);
    } else {
        parent.insertBefore(document.createTextNode(String(/** @type {Primitive} */ (child))), anchor);
    }
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
        setProperty(element, key, /** @type {Record<string, unknown>} */ (props)[key]);
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
 *     item: T,
 *     idx: number,
 *     itemSig: import('@slimlib/store').Signal<T>,
 *     idxSig: import('@slimlib/store').Signal<number> | null,
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
 *   `index()` lazily allocates its backing signal on first call.
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

    const fragment = document.createDocumentFragment();
    const start = document.createComment('');
    const end = document.createComment('');
    fragment.appendChild(start);
    fragment.appendChild(end);

    /** @type {Map<string | number, Entry<T>>} */
    let previousMap = new Map();

    effect(() => {
        const array = each();
        const length = array.length;
        /** @type {Map<string | number, Entry<T>>} */
        const newMap = new Map();
        /** @type {Entry<T>[]} */
        const newEntries = new Array(length);

        // Reconciliation runs untracked so that signal reads performed by `body`
        // during item construction (and by per-item function-child effects when
        // they first wire up under the outer effect's stack) don't accidentally
        // subscribe the outer effect to per-item signals. Otherwise updating an
        // item via `itemSig.set` from within this run would re-schedule the
        // outer effect — triggering the store's cycle guard.
        untracked(() => {
            for (let i = 0; i < length; ++i) {
                const item = /** @type {T} */ (array[i]);
                const k = key(item, i);
                const existing = previousMap.get(k);
                /** @type {Entry<T>} */
                let entry;
                if (existing !== undefined) {
                    // Cached fields short-circuit the signal getter calls.
                    if (existing.item !== item) {
                        existing.item = item;
                        existing.itemSig.set(item);
                    }
                    if (existing.idx !== i) {
                        existing.idx = i;
                        if (existing.idxSig !== null) existing.idxSig.set(i);
                    }
                    previousMap.delete(k);
                    entry = existing;
                } else {
                    const itemSignal = signal(item);
                    /** @type {Entry<T>} */
                    const newEntry = {
                        node: /** @type {Node} */ (/** @type {unknown} */ (null)),
                        item,
                        idx: i,
                        itemSig: itemSignal,
                        idxSig: null,
                        dispose: /** @type {() => void} */ (/** @type {unknown} */ (null)),
                    };
                    // Lazy index signal: most lists never read `index()`.
                    const indexFn = () => {
                        if (newEntry.idxSig === null) newEntry.idxSig = signal(newEntry.idx);
                        return newEntry.idxSig();
                    };
                    newEntry.dispose = scope(onDispose => {
                        // Route non-effect cleanups (on:* listeners, ref(null)) into THIS
                        // sub-scope so they tear down when the item is removed. Without
                        // this, the renderer's module-level dispose register still points
                        // at the surrounding scope and listeners outlive the item.
                        const previousOnDispose = currentOnDispose;
                        currentOnDispose = onDispose;
                        try {
                            const built = body(itemSignal, indexFn);
                            if (DEV && !(built instanceof Node)) {
                                throw new Error('forEach: body must return a single Node');
                            }
                            newEntry.node = /** @type {Node} */ (built);
                        } finally {
                            currentOnDispose = previousOnDispose;
                        }
                    }, parentScope);
                    entry = newEntry;
                }
                newMap.set(k, entry);
                newEntries[i] = entry;
            }
        });

        const parent = /** @type {Node} */ (end.parentNode);

        // Remove entries that vanished from the new list. Pure DOM + scope
        // disposal, no signal reads — safe to run outside untracked().
        for (const entry of previousMap.values()) {
            entry.dispose();
            parent.removeChild(entry.node);
        }

        // Reorder + insert. Walk new order in reverse so each step's anchor
        // (the node that should follow `i`) is already in its final position.
        /** @type {Node} */
        let nextRef = end;
        for (let i = length - 1; i >= 0; --i) {
            const entry = /** @type {Entry<T>} */ (newEntries[i]);
            if (entry.node.nextSibling !== nextRef) {
                parent.insertBefore(entry.node, nextRef);
            }
            nextRef = entry.node;
        }

        previousMap = newMap;
    });

    return fragment;
};
