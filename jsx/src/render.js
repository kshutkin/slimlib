import { scope as createScope } from '@slimlib/store';

import { createElement, setOnDispose } from './create-element.js';

/** @typedef {import('./types.js').Child} Child */

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
    return createScope(onDispose => {
        const prev = setOnDispose(onDispose);
        try {
            container.appendChild(createElement(factory, null));
        } finally {
            setOnDispose(prev);
        }
    });
};
