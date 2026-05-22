import { DEV } from 'esm-env';

import { activeScope, effect, scope, signal, untracked } from '@slimlib/store';

import type { Scope, Signal } from '@slimlib/store';
import type { Child, Component, ElementType, Primitive, Props } from './types';

/**
 * Fragment is a no-op component that simply returns its children.
 * No special-case in the renderer; treated as any other component.
 */
export const Fragment: Component<{ children?: Child }> = props => props.children;

/**
 * Module-level "current dispose register". `render()` sets this before building the tree
 * and clears it after. Non-effect cleanups (ref-null callbacks, event listener removal)
 * register through here. Effects register with the active store scope automatically.
 *
 * Manipulated via inlined `prev = currentOnDispose; currentOnDispose = …` swaps at
 * render(), appendChild() function-child, and forEach() per-item sites; restored in a
 * `finally` block for nesting safety. Cleanup registration is inlined as well:
 * `if (currentOnDispose !== null) currentOnDispose(cb);`.
 */
let currentOnDispose: ((cb: () => void) => void) | null = null;

/**
 * Module-level current XML namespace. When set, `createElementArray` uses
 * `createElementNS` instead of `createElement`. Toggled by the opt-in `svg()` /
 * `html()` factory wrappers; `undefined` means the default HTML path.
 */
let currentNamespace: string | undefined;

/**
 * Dispatch table keyed by "tagName,propName". `true` = writable DOM property
 * (use `element[key] = value`), `false` = read-only / no descriptor (fall back
 * to `setAttribute`/`removeAttribute`). Resolved lazily on first access.
 */
const propertiesSetterCache = new Map<string, boolean>();

const resolveProperty = (element: Element, key: string, cacheKey: string): boolean => {
    let prototype: object | null = Object.getPrototypeOf(element);
    while (prototype !== null) {
        const desc = Object.getOwnPropertyDescriptor(prototype, key);
        if (desc !== undefined) {
            const writable = desc.set !== undefined;
            propertiesSetterCache.set(cacheKey, writable);
            return writable;
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    // Do not cache "no descriptor anywhere" — element may be a custom element
    // that hasn't been upgraded yet; later upgrades add IDL setters to the proto.
    return false;
};

const applyAttribute = (element: Element, key: string, value: unknown): void => {
    if (value === false || value == null) {
        element.removeAttribute(key);
    } else {
        element.setAttribute(key, value === true ? '' : '' + value);
    }
};

/**
 * Apply a single prop value (static). A colon at index 4 is a cheap gate for
 * the `prop:` / `attr:` namespaces; we then confirm the prefix explicitly so
 * unrelated keys (e.g. `data:foo`) still fall through to the setter cache.
 */
const applyProperty = (element: Element, key: string, value: unknown): void => {
    if (key[4] === ':') {
        const prefix = key.slice(0, 4);
        const k = key.slice(5);
        if (prefix === 'prop') {
            (element as unknown as Record<string, unknown>)[k] = value;
            return;
        }
        if (prefix === 'attr') {
            applyAttribute(element, k, value);
            return;
        }
    }
    const cacheKey = `${element.tagName},${key}`;
    const writable = propertiesSetterCache.get(cacheKey) ?? resolveProperty(element, key, cacheKey);
    if (writable) {
        (element as unknown as Record<string, unknown>)[key] = value;
    } else {
        applyAttribute(element, key, value);
    }
};

/**
 * Set a prop, wiring up reactivity when value is a function.
 */
const setProperty = (element: Element, key: string, value: unknown): void => {
    if (key.startsWith('on:')) {
        const eventName = key.slice(3);
        if (typeof value === 'function') {
            const listener = value as EventListener;
            element.addEventListener(eventName, listener);
            currentOnDispose?.(() => element.removeEventListener(eventName, listener));
        }
    } else if (key === 'ref') {
        if (typeof value === 'function') {
            const refFn = value as (e: Element | null) => void;
            refFn(element);
            currentOnDispose?.(() => refFn(null));
        }
    } else if (typeof value === 'function') {
        const reactive = value as () => unknown;
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
 */
const appendChild = (parent: Node, child: Child): void => {
    if (child instanceof Node) {
        parent.appendChild(child);
    } else if (typeof child === 'string') {
        parent.appendChild(document.createTextNode(child));
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
        let scopeInstance: Scope | undefined;
        // Fast path: when the function-child resolves to a primitive we keep a
        // single Text node across re-runs and mutate `.data` in place instead
        // of paying for removeChild + createTextNode + insertBefore.
        let textNode: Text | null = null;
        effect(() => {
            let value!: Child;
            const newScope: Scope = scope(onDispose => {
                const prev = currentOnDispose;
                currentOnDispose = onDispose;
                try {
                    value = (child as () => Child)();
                } finally {
                    currentOnDispose = prev;
                }
            }, parentScope);
            const isPrimitive =
                value != null && value !== false && value !== true && typeof value !== 'object' && typeof value !== 'function';
            if (isPrimitive && textNode !== null) {
                // Text fast path: reuse existing node, no DOM thrash.
                const str = '' + value;
                if (textNode.data !== str) textNode.data = str;
                newScope();
                return;
            }
            // Slow path: clear sibling range. The previous scope (if any) was
            // already torn down by this effect's cleanup before re-run.
            let nextSibling = start.nextSibling;
            while (nextSibling !== end) {
                const nextNextSibling = (nextSibling as ChildNode).nextSibling;
                parent.removeChild(nextSibling as ChildNode);
                nextSibling = nextNextSibling;
            }
            if (isPrimitive) {
                textNode = document.createTextNode('' + (value as Primitive));
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
    } else if (Array.isArray(child)) {
        const length = child.length;
        appendChildren(parent, child, length);
    } else if (child != null && child !== false && child !== true) {
        parent.appendChild(document.createTextNode('' + (child as Primitive)));
    }
};

/**
 * Insert a Child immediately before `anchor`.
 */
const insertBefore = (parent: Node, child: Child, anchor: Node): void => {
    if (child == null || child === false || child === true) {
        // skip
    } else if (Array.isArray(child)) {
        const length = child.length;
        for (let i = 0; i < length; ++i) {
            insertBefore(parent, child[i] as Child, anchor);
        }
    } else if (child instanceof Node) {
        parent.insertBefore(child, anchor);
    } else if (typeof child === 'function') {
        // One-shot eager evaluation: a function-child returning another function
        // is unwrapped here without creating an effect. No re-runs → no leak,
        // so no sub-scope is needed. The outer effect (set up by appendChild)
        // owns reactivity for this slot.
        insertBefore(parent, (child as () => Child)(), anchor);
    } else {
        parent.insertBefore(document.createTextNode('' + (child as Primitive)), anchor);
    }
};

/**
 * Internal: build a Node from an already-arrayed children list. Shared by both
 * the public varargs `createElement` and the JSX automatic-runtime entry points
 * (`jsx` / `jsxs`) to avoid the array → spread → rest → array roundtrip.
 */
export const createElementArray = <P extends Props>(type: ElementType<P>, props: P | null, children: readonly Child[]): Node => {
    const childrenLength = children.length;
    if (typeof type === 'function') {
        // Inject children into props only when present; avoid spread allocation otherwise.
        const compProps: Props =
            childrenLength === 0
                ? ((props ?? {}) as Props)
                : ({
                      ...(props as Props),
                      children: childrenLength === 1 ? children[0] : children,
                  } as Props);
        const result = (type as Component<Props>)(compProps);
        // Fast path: component returned a single Node — no fragment wrapping needed.
        if (result instanceof Node) {
            return result;
        }
        // Fallback for primitives / arrays / function-children: wrap in a fragment.
        const fragment = document.createDocumentFragment();
        appendChild(fragment, result);
        return fragment;
    }
    const element = currentNamespace !== undefined
        ? document.createElementNS(currentNamespace, type)
        : document.createElement(type);
    for (const key in props) {
        setProperty(element, key, (props as Record<string, unknown>)[key]);
    }
    appendChildren(element, children, childrenLength);
    return element;
};

const appendChildren = (parent: Node, children: readonly Child[], length: number): void => {
    for (let i = 0; i < length; ++i) {
        appendChild(parent, children[i] as Child);
    }
};

/**
 * Build a Node for a JSX element (classic varargs signature).
 */
export const createElement = <P extends Props>(type: ElementType<P>, props: P | null, ...children: Child[]): Node =>
    createElementArray(type, props, children);

/**
 * Opt-in factory: run `fn` with the SVG namespace active so any JSX elements
 * created inside use `createElementNS`. Nesting safe (restores previous ns).
 */
export const svg = <T>(fn: () => T): T => {
    const prev = currentNamespace;
    currentNamespace = 'http://www.w3.org/2000/svg';
    try {
        return fn();
    } finally {
        currentNamespace = prev;
    }
};

/**
 * Inverse of `svg()`: forces the HTML namespace (used inside `<foreignObject>`).
 */
export const html = <T>(fn: () => T): T => {
    const prev = currentNamespace;
    currentNamespace = undefined;
    try {
        return fn();
    } finally {
        currentNamespace = prev;
    }
};

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
 */
export const render = (factory: () => Child, container: Element | DocumentFragment): (() => void) => {
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

type Entry<T> = {
    $_node: Node;
    $_item: T;
    $_index: number;
    $_itemSignal: Signal<T>;
    $_indexSignal: Signal<number> | null;
    $_dispose: () => void;
};

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
 */
export const forEach = <T>(
    each: () => readonly T[],
    key: (item: T, index: number) => string | number,
    body: (item: () => T, index: () => number) => Child
): DocumentFragment => {
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

    let previousMap = new Map<string | number, Entry<T>>();

    effect(() => {
        const array = each();
        const length = array.length;
        const newMap = new Map<string | number, Entry<T>>();
        const newEntries: Entry<T>[] = new Array(length);

        // Reconciliation runs untracked so that signal reads performed by `body`
        // during item construction (and by per-item function-child effects when
        // they first wire up under the outer effect's stack) don't accidentally
        // subscribe the outer effect to per-item signals. Otherwise updating an
        // item via `itemSig.set` from within this run would re-schedule the
        // outer effect — triggering the store's cycle guard.
        untracked(() => {
            for (let i = 0; i < length; ++i) {
                const item = array[i] as T;
                const k = key(item, i);
                const existing = previousMap.get(k);
                let entry: Entry<T>;
                if (existing !== undefined) {
                    // Cached fields short-circuit the signal getter calls.
                    if (!Object.is(existing.$_item, item)) {
                        existing.$_item = item;
                        existing.$_itemSignal.set(item);
                    }
                    if (existing.$_index !== i) {
                        existing.$_index = i;
                        if (existing.$_indexSignal !== null) {
                            existing.$_indexSignal.set(i);
                        }
                    }
                    previousMap.delete(k);
                    entry = existing;
                } else {
                    const itemSignal = signal(item);
                    const newEntry: Entry<T> = {
                        $_node: null as unknown as Node,
                        $_item: item,
                        $_index: i,
                        $_itemSignal: itemSignal,
                        $_indexSignal: null,
                        $_dispose: null as unknown as () => void,
                    };
                    // Lazy index signal: most lists never read `index()`.
                    const indexFn = () => {
                        if (newEntry.$_indexSignal === null) {
                            newEntry.$_indexSignal = signal(newEntry.$_index);
                        }
                        return newEntry.$_indexSignal();
                    };
                    newEntry.$_dispose = scope(onDispose => {
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
                            newEntry.$_node = built as Node;
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

        const parent = end.parentNode as Node;

        // Remove entries that vanished from the new list. Pure DOM + scope
        // disposal, no signal reads — safe to run outside untracked().
        for (const entry of previousMap.values()) {
            entry.$_dispose();
            parent.removeChild(entry.$_node);
        }

        // Reorder + insert. Trim already-correct head/tail, then walk the
        // remaining middle in reverse so each step's anchor (the node that
        // should follow `i`) is already in its final position.
        let firstUnplaced = 0;
        let lastUnplaced = length - 1;
        // Head trim: advance past entries already at the correct DOM slot.
        let headReference = start.nextSibling;
        while (firstUnplaced <= lastUnplaced && (newEntries[firstUnplaced] as Entry<T>).$_node === headReference) {
            headReference = (headReference as Node).nextSibling;
            ++firstUnplaced;
        }
        // Tail trim: retreat past entries already at the correct DOM slot.
        let tailReference: Node = end;
        while (lastUnplaced >= firstUnplaced) {
            const expected = tailReference.previousSibling;
            if ((newEntries[lastUnplaced] as Entry<T>).$_node !== expected) {
                break;
            }
            tailReference = expected as Node;
            --lastUnplaced;
        }
        let nextReference: Node = tailReference;
        for (let i = lastUnplaced; i >= firstUnplaced; --i) {
            const entry = newEntries[i] as Entry<T>;
            if (entry.$_node.nextSibling !== nextReference) {
                parent.insertBefore(entry.$_node, nextReference);
            }
            nextReference = entry.$_node;
        }

        previousMap = newMap;
    });

    return fragment;
};
