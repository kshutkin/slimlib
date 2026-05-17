import { effect, flushEffects, scope, signal, untracked } from '@slimlib/store';

import { setOnDispose } from './index';
import type { Signal } from '@slimlib/store';
import type { Child } from './types';

type Entry<T> = {
    node: Node;
    itemSig: Signal<T>;
    idxSig: Signal<number>;
    dispose: () => void;
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
    const frag = document.createDocumentFragment();
    const start = document.createComment('');
    const end = document.createComment('');
    frag.appendChild(start);
    frag.appendChild(end);

    let prevMap = new Map<string | number, Entry<T>>();

    effect(() => {
        const arr = each();
        const len = arr.length;
        const newMap = new Map<string | number, Entry<T>>();
        const newKeys: (string | number)[] = new Array(len);

        // Reconciliation runs untracked so that signal reads performed by `body`
        // during item construction (and by per-item function-child effects when
        // they first wire up under the outer effect's stack) don't accidentally
        // subscribe the outer effect to per-item signals. Otherwise updating an
        // item via `itemSig.set` from within this run would re-schedule the
        // outer effect — triggering the store's cycle guard.
        untracked(() => {
            for (let i = 0; i < len; i++) {
                const item = arr[i] as T;
                const k = key(item, i);
                newKeys[i] = k;
                const existing = prevMap.get(k);
                let entry: Entry<T>;
                if (existing !== undefined) {
                    if (!Object.is(existing.itemSig(), item)) existing.itemSig.set(item);
                    if (existing.idxSig() !== i) existing.idxSig.set(i);
                    prevMap.delete(k);
                    entry = existing;
                } else {
                    const itemSig = signal<T>(item);
                    const idxSig = signal<number>(i);
                    let node: Node | undefined;
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
                    });
                    entry = { node: node as Node, itemSig, idxSig, dispose };
                }
                newMap.set(k, entry);
            }

            const parent = end.parentNode as Node;

            // Remove entries that vanished from the new list.
            for (const entry of prevMap.values()) {
                entry.dispose();
                parent.removeChild(entry.node);
            }

            // Reorder + insert. Walk new order in reverse so each step's anchor
            // (the node that should follow `i`) is already in its final position.
            let nextRef: Node = end;
            for (let i = len - 1; i >= 0; i--) {
                const entry = newMap.get(newKeys[i] as string | number) as Entry<T>;
                if (entry.node.nextSibling !== nextRef) {
                    parent.insertBefore(entry.node, nextRef);
                }
                nextRef = entry.node;
            }

            prevMap = newMap;

            // Drain any per-item child effects scheduled during this run (e.g.
            // function-child effects wired by `{() => item().name}`). They live in
            // the global batch queue and would otherwise wait for the next
            // microtask flush, leaving freshly-mounted items briefly empty in
            // synchronous observation paths. flushEffects() re-entry is safe: it
            // snapshots the queue at entry.
            flushEffects();
        });
    });

    return frag;
};
