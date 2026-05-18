import { activeScope, effect, scope, signal, untracked } from '@slimlib/store';

import { setOnDispose } from './index.js';

/** @typedef {import('./types.js').Child} Child */

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
                        const prev = setOnDispose(onDispose);
                        try {
                            const built = body(itemSig, idxSig);
                            if (!(built instanceof Node)) {
                                throw new Error('forEach: body must return a single Node');
                            }
                            node = built;
                        } finally {
                            setOnDispose(prev);
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
