import { effect } from '@slimlib/store';

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
 */
let currentOnDispose: ((cb: () => void) => void) | null = null;

/** Internal: set the current dispose register; returns the previous one (for nesting). */
export const setOnDispose = (cb: ((cb: () => void) => void) | null): ((cb: () => void) => void) | null => {
    const prev = currentOnDispose;
    currentOnDispose = cb;
    return prev;
};

const registerCleanup = (cb: () => void): void => {
    if (currentOnDispose !== null) currentOnDispose(cb);
};

/** Cache of resolved property setters keyed by "tagName,propName". Stored unbound; bound per-call. */
const propSetterCache = new Map<string, ((value: unknown) => void) | null>();

const getPropSetter = (el: Element, key: string): ((value: unknown) => void) | null => {
    const cacheKey = `${el.tagName},${key}`;
    let setter = propSetterCache.get(cacheKey);
    if (setter !== undefined) return setter;
    let proto: object | null = Object.getPrototypeOf(el);
    while (proto !== null) {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if (desc !== undefined) {
            setter = desc.set !== undefined ? (desc.set as (value: unknown) => void) : null;
            propSetterCache.set(cacheKey, setter);
            return setter;
        }
        proto = Object.getPrototypeOf(proto);
    }
    propSetterCache.set(cacheKey, null);
    return null;
};

/** Apply a single prop value (static). */
const applyProp = (el: Element, key: string, value: unknown): void => {
    if (key.startsWith('prop:')) {
        (el as unknown as Record<string, unknown>)[key.slice(5)] = value;
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

/** Set a prop, wiring up reactivity when value is a function. */
const setProp = (el: Element, key: string, value: unknown): void => {
    if (key.startsWith('on:')) {
        const eventName = key.slice(3);
        if (typeof value === 'function') {
            el.addEventListener(eventName, value as EventListener);
            registerCleanup(() => el.removeEventListener(eventName, value as EventListener));
        }
        return;
    }
    if (key === 'ref') {
        if (typeof value === 'function') {
            (value as (e: Element | null) => void)(el);
            registerCleanup(() => (value as (e: Element | null) => void)(null));
        }
        return;
    }
    if (typeof value === 'function') {
        // effect() auto-registers with the active store scope.
        effect(() => {
            applyProp(el, key, (value as () => unknown)());
        });
        return;
    }
    applyProp(el, key, value);
};

/** Append a Child into a parent Node, creating reactive bindings as needed. */
const appendChild = (parent: Node, child: Child): void => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
        for (const c of child) appendChild(parent, c);
        return;
    }
    if (typeof child === 'function') {
        const start = document.createComment('');
        const end = document.createComment('');
        parent.appendChild(start);
        parent.appendChild(end);
        effect(() => {
            let n = start.nextSibling;
            while (n !== null && n !== end) {
                const next = n.nextSibling;
                parent.removeChild(n);
                n = next;
            }
            insertBefore(parent, (child as () => Child)(), end);
        });
        return;
    }
    if (child instanceof Node) {
        parent.appendChild(child);
        return;
    }
    parent.appendChild(document.createTextNode(String(child as Primitive)));
};

/** Insert a Child immediately before `anchor`. */
const insertBefore = (parent: Node, child: Child, anchor: Node): void => {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) {
        for (const c of child) insertBefore(parent, c, anchor);
        return;
    }
    if (child instanceof Node) {
        parent.insertBefore(child, anchor);
        return;
    }
    if (typeof child === 'function') {
        insertBefore(parent, (child as () => Child)(), anchor);
        return;
    }
    parent.insertBefore(document.createTextNode(String(child as Primitive)), anchor);
};

/** Build a Node for a JSX element. Uses module-level scope state. */
export const createElement = <P extends Props>(type: ElementType<P>, props: P | null, ...children: Child[]): Node => {
    const allProps = (props ?? {}) as Props;
    if (typeof type === 'function') {
        const result = (type as Component<Props>)({
            ...allProps,
            children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
        });
        const frag = document.createDocumentFragment();
        appendChild(frag, result);
        return frag;
    }
    const el = document.createElement(type);
    for (const [k, v] of Object.entries(allProps)) {
        if (k === 'children') continue;
        setProp(el, k, v);
    }
    for (const c of children) appendChild(el, c);
    return el;
};
