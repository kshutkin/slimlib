import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushEffects, setScheduler, signal } from '@slimlib/store';

import { forEach } from '../src/for-each.ts';
import { createElement, render } from '../src/index.ts';

// Synchronous scheduler: effects run inline on creation/write. JSX itself no
// longer calls flushEffects() (full async-commit contract); tests opt into
// synchronous observation by installing a sync scheduler.
setScheduler(fn => fn());

let customElementId = 0;
const uniqueTag = baseName => `${baseName}-${++customElementId}`;

let mounted = [];
afterEach(() => {
    for (const d of mounted) d();
    mounted = [];
    document.body.innerHTML = '';
});

const mount = factory => {
    const dispose = render(factory, document.body);
    mounted.push(dispose);
    return dispose;
};

const liNodes = () => Array.from(document.querySelectorAll('li'));

describe('forEach — keyed list renderer', () => {
    it.each([
        ['rotate right', ids => [ids.at(-1), ...ids.slice(0, -1)], 1],
        ['rotate left', ids => [...ids.slice(1), ids[0]], 1],
        [
            'swap distant rows',
            ids => {
                const next = ids.slice();
                [next[1], next[998]] = [next[998], next[1]];
                return next;
            },
            2,
        ],
        ['reverse', ids => ids.toReversed(), 999],
    ])('%s uses the minimum DOM moves', (_name, reorder, expectedMoves) => {
        const initial = Array.from({ length: 1000 }, (_, id) => id);
        const items = signal(initial);
        let builds = 0;
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    item => {
                        ++builds;
                        return createElement('li', null, item());
                    }
                )
            )
        );
        const nodes = liNodes();
        const parent = nodes[0].parentNode;
        const insert = vi.spyOn(parent, 'insertBefore');
        const next = reorder(initial);

        items.set(next);
        flushEffects();

        expect(insert).toHaveBeenCalledTimes(expectedMoves);
        expect(liNodes()).toEqual(next.map(id => nodes[id]));
        expect(builds).toBe(1000);
        insert.mockRestore();
    });

    it('minimizes moves for all permutations of five rows', () => {
        const initial = [0, 1, 2, 3, 4];
        const items = signal(initial);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    item => createElement('li', null, item())
                )
            )
        );
        const nodes = liNodes();
        const insert = vi.spyOn(nodes[0].parentNode, 'insertBefore');
        const permutations = values =>
            values.length === 0
                ? [[]]
                : values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest]));

        for (const next of permutations(initial)) {
            items.set(initial);
            flushEffects();
            insert.mockClear();
            // Independent quadratic oracle for the longest increasing length.
            const lengths = next.map(() => 1);
            for (let i = 0; i < next.length; ++i) {
                for (let j = 0; j < i; ++j) {
                    if (next[j] < next[i]) lengths[i] = Math.max(lengths[i], lengths[j] + 1);
                }
            }
            items.set(next);
            flushEffects();
            expect(liNodes()).toEqual(next.map(id => nodes[id]));
            expect(insert.mock.calls.length).toBe(next.length - Math.max(...lengths));
        }
        insert.mockRestore();
    });

    it('reconciles from actual DOM order after consumer moves and detachment', () => {
        const initial = [0, 1, 2, 3, 4];
        const items = signal(initial);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    item => createElement('li', null, item())
                )
            )
        );
        const nodes = liNodes();
        const parent = nodes[0].parentNode;
        parent.insertBefore(nodes[4], nodes[0]);
        nodes[2].remove();

        items.set([3, 4, 2, 0, 1]);
        flushEffects();

        expect(liNodes()).toEqual([nodes[3], nodes[4], nodes[2], nodes[0], nodes[1]]);
    });

    it('mixes insertion, removal, and minimal moves while retaining row bindings', () => {
        const items = signal([0, 1, 2, 3, 4]);
        const cleaned = [];
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    (item, index) => {
                        const id = item();
                        return createElement(
                            'li',
                            {
                                ref: node => {
                                    if (node === null) cleaned.push(id);
                                },
                            },
                            () => `${item()}:${index()}`
                        );
                    }
                )
            )
        );
        const nodes = liNodes();
        const insert = vi.spyOn(nodes[0].parentNode, 'insertBefore');

        items.set([4, 5, 1, 3]);
        flushEffects();

        expect(insert).toHaveBeenCalledTimes(2); // One new row, one moved row.
        expect(liNodes().map(node => node.textContent)).toEqual(['4:0', '5:1', '1:2', '3:3']);
        expect(liNodes()[0]).toBe(nodes[4]);
        expect(liNodes()[2]).toBe(nodes[1]);
        expect(liNodes()[3]).toBe(nodes[3]);
        expect(cleaned).toEqual([0, 2]);
        insert.mockRestore();
    });

    it('keeps focus inside an unaffected row during a distant swap', () => {
        const items = signal(Array.from({ length: 10 }, (_, id) => id));
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    () => createElement('li', null, createElement('input', null))
                )
            )
        );
        const input = liNodes()[5].firstChild;
        input.focus();
        expect(document.activeElement).toBe(input);

        items.set([0, 8, 2, 3, 4, 5, 6, 7, 1, 9]);
        flushEffects();

        expect(document.activeElement).toBe(input);
    });

    it('tears down row scopes if a move disconnect callback clears the anchors', () => {
        const items = signal([0, 1, 2, 3]);
        const shared = signal(0);
        let armed = false;
        let fires = 0;
        const cleaned = [];
        const tag = uniqueTag('x-list-clear-on-move');
        customElements.define(
            tag,
            class extends HTMLElement {
                connectedCallback() {
                    this.container = this.parentNode;
                }
                disconnectedCallback() {
                    if (armed) this.container?.replaceChildren();
                }
            }
        );
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    items,
                    id => id,
                    item => {
                        const id = item();
                        return createElement(
                            tag,
                            {
                                ref: node => {
                                    if (node === null) cleaned.push(id);
                                },
                            },
                            () => {
                                shared();
                                ++fires;
                                return item();
                            }
                        );
                    }
                )
            )
        );
        armed = true;

        expect(() => {
            items.set([3, 0, 1, 2]);
            flushEffects();
        }).not.toThrow();
        expect(document.querySelector('ul').childNodes.length).toBe(0);
        expect(cleaned.toSorted()).toEqual([0, 1, 2, 3]);
        const before = fires;
        shared.set(1);
        flushEffects();
        expect(fires).toBe(before);
    });

    it('1. initial render with 3 items', () => {
        const items = signal([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
            { id: 'c', name: 'C' },
        ]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().name)
                )
            )
        );
        expect(liNodes().map(n => n.textContent)).toEqual(['A', 'B', 'C']);
    });

    it('2. append', () => {
        const items = signal([{ id: 'a', name: 'A' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().name)
                )
            )
        );
        items.set([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
        ]);
        flushEffects();
        expect(liNodes().map(n => n.textContent)).toEqual(['A', 'B']);
    });

    it('3. remove middle item', () => {
        const items = signal([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
            { id: 'c', name: 'C' },
        ]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().name)
                )
            )
        );
        const [a0, , c0] = liNodes();
        items.set([
            { id: 'a', name: 'A' },
            { id: 'c', name: 'C' },
        ]);
        flushEffects();
        const [a1, c1] = liNodes();
        expect(a1).toBe(a0);
        expect(c1).toBe(c0);
        expect(liNodes().map(n => n.textContent)).toEqual(['A', 'C']);
    });

    it('4. reorder (swap) — DOM nodes are moved, not recreated', () => {
        const a = { id: 'a', name: 'A' };
        const b = { id: 'b', name: 'B' };
        const c = { id: 'c', name: 'C' };
        const items = signal([a, b, c]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().name)
                )
            )
        );
        const [na0, nb0, nc0] = liNodes();
        items.set([a, c, b]);
        flushEffects();
        const [na1, nc1, nb1] = liNodes();
        expect(na1).toBe(na0);
        expect(nb1).toBe(nb0);
        expect(nc1).toBe(nc0);
        expect(liNodes().map(n => n.textContent)).toEqual(['A', 'C', 'B']);
    });

    it('5. value update (same key, new value) updates body bindings; node identity preserved', () => {
        const items = signal([{ id: 'a', name: 'A' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().name)
                )
            )
        );
        const liBefore = liNodes()[0];
        items.set([{ id: 'a', name: 'A-updated' }]);
        flushEffects();
        const liAfter = liNodes()[0];
        expect(liAfter).toBe(liBefore);
        expect(liAfter.textContent).toBe('A-updated');
    });

    it('6. index update on reorder is reflected via index() getter', () => {
        const a = { id: 'a' };
        const b = { id: 'b' };
        const c = { id: 'c' };
        const items = signal([a, b, c]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    (item, index) => createElement('li', null, () => `${item().id}:${index()}`)
                )
            )
        );
        expect(liNodes().map(n => n.textContent)).toEqual(['a:0', 'b:1', 'c:2']);
        items.set([c, a, b]);
        flushEffects();
        expect(liNodes().map(n => n.textContent)).toEqual(['c:0', 'a:1', 'b:2']);
    });

    it('7. per-item sub-scope tears down on removal', () => {
        const cleanups = { a: 0, b: 0 };
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item =>
                        createElement('li', {
                            'data-id': item().id,
                            ref: el => {
                                if (el === null) cleanups[item().id]++;
                            },
                        })
                )
            )
        );
        items.set([{ id: 'a' }]);
        flushEffects();
        expect(cleanups.b).toBe(1);
        expect(cleanups.a).toBe(0);
    });

    it('8. per-item on:click is detached on removal', () => {
        const onClick = vi.fn();
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', { 'on:click': onClick, 'data-id': item().id }, item().id)
                )
            )
        );
        const removed = document.querySelector('[data-id="b"]');
        items.set([{ id: 'a' }]);
        flushEffects();
        // Dispatch on detached node — listener should not fire.
        removed.dispatchEvent(new Event('click'));
        expect(onClick).not.toHaveBeenCalled();
        // Still works on surviving node.
        document.querySelector('[data-id="a"]').dispatchEvent(new Event('click'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('9. full unmount via render dispose tears down everything', () => {
        const cleanups = [];
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        const dispose = mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item =>
                        createElement('li', {
                            ref: el => {
                                if (el === null) cleanups.push(item().id);
                            },
                        })
                )
            )
        );
        expect(document.querySelectorAll('li').length).toBe(2);
        dispose();
        // Remove from `mounted` so afterEach doesn't double-dispose.
        mounted = mounted.filter(d => d !== dispose);
        expect(cleanups.sort()).toEqual(['a', 'b']);
        // After dispose the outer scope is dead: further signal writes must NOT
        // resurrect reactivity (no errors, no node churn).
        items.set([{ id: 'c' }]);
        flushEffects();
        expect(cleanups.sort()).toEqual(['a', 'b']);
    });

    it('10. empty array initial render', () => {
        const items = signal([]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, item.id)
                )
            )
        );
        expect(document.querySelectorAll('li').length).toBe(0);
        expect(document.querySelector('ul')).not.toBeNull();
    });

    it('11. empty → some → empty cycle', () => {
        const items = signal([]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().id)
                )
            )
        );
        expect(document.querySelectorAll('li').length).toBe(0);
        items.set([{ id: 'a' }, { id: 'b' }]);
        flushEffects();
        expect(liNodes().map(n => n.textContent)).toEqual(['a', 'b']);
        items.set([]);
        flushEffects();
        expect(document.querySelectorAll('li').length).toBe(0);
    });

    it('12. all items replaced (none share keys)', () => {
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().id)
                )
            )
        );
        const oldNodes = liNodes();
        items.set([{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
        flushEffects();
        const newNodes = liNodes();
        expect(newNodes.map(n => n.textContent)).toEqual(['x', 'y', 'z']);
        for (const n of newNodes) expect(oldNodes).not.toContain(n);
    });

    it('13. body returning a non-Node is reported (effect error path)', () => {
        // @slimlib/jsx uses EAGER effects internally: forEach's reconciler
        // effect runs synchronously during render, so a non-Node returned by
        // body propagates up to the caller (preserving the stack trace)
        // instead of being swallowed by the deferred flush's console.error.
        expect(() =>
            mount(() =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => [{ id: 'a' }],
                        item => item.id,
                        () => 'not a node'
                    )
                )
            )
        ).toThrow(/single Node/);
    });

    it('14. render dispose tears down per-item reactive children (no orphan scopes)', () => {
        // Regression test: per-item scopes used to be created during reconciler
        // effect re-runs, when activeScope is undefined — making them orphans
        // unreachable from the render scope. render() dispose then failed to
        // tear down per-item reactive children (function-child inner effects),
        // and they kept firing on shared-signal changes.
        //
        // The bug only manifests with the async default scheduler: with the
        // sync scheduler the reconciler effect runs synchronously while the
        // surrounding scope is still active. Use a manual flush queue here.
        const queue = [];
        setScheduler(fn => queue.push(fn));
        const flush = () => {
            while (queue.length) queue.shift()();
            flushEffects();
        };
        try {
            const shared = signal(0);
            const items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
            let itemFires = 0;
            const dispose = render(
                () =>
                    createElement(
                        'ul',
                        null,
                        forEach(
                            () => items(),
                            item => item.id,
                            item =>
                                createElement('li', null, () => {
                                    shared();
                                    item();
                                    itemFires++;
                                    return String(item().id);
                                })
                        )
                    ),
                document.body
            );
            flush();
            expect(itemFires).toBe(3);
            shared.set(1);
            flush();
            expect(itemFires).toBe(6);

            dispose();
            const before = itemFires;
            shared.set(2);
            flush();
            // Without the fix: orphan per-item scopes survive dispose and the
            // shared-signal write re-fires every item's inner effect.
            expect(itemFires).toBe(before);
        } finally {
            setScheduler(fn => fn());
            document.body.innerHTML = '';
        }
    });

    it('15. stale anchors dispose row scopes instead of reconciling detached DOM', () => {
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        const shared = signal(0);
        let itemFires = 0;
        const dispose = render(
            () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => items(),
                        item => item.id,
                        item =>
                            createElement('li', null, () => {
                                shared();
                                itemFires++;
                                return item().id;
                            })
                    )
                ),
            document.body
        );
        mounted.push(dispose);
        expect(liNodes().map(n => n.textContent)).toEqual(['a', 'b']);
        expect(itemFires).toBe(2);

        document.querySelector('ul').replaceChildren();

        expect(() => {
            items.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
            flushEffects();
        }).not.toThrow();
        expect(liNodes()).toEqual([]);

        const before = itemFires;
        shared.set(1);
        flushEffects();
        expect(itemFires).toBe(before);
    });

    it('16. child disconnect can clear list anchors during removal', () => {
        const items = signal([{ id: 'clear' }, { id: 'kept' }]);
        const tag = uniqueTag('x-for-each-clear-on-disconnect');

        customElements.define(
            tag,
            class extends HTMLElement {
                _parent = null;

                connectedCallback() {
                    this._parent = this.parentNode;
                }

                disconnectedCallback() {
                    this._parent?.replaceChildren();
                }
            }
        );

        const dispose = render(
            () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => items(),
                        item => item.id,
                        item => (item().id === 'clear' ? createElement(tag, null) : createElement('li', null, item().id))
                    )
                ),
            document.body
        );
        mounted.push(dispose);
        expect(document.querySelector(tag)).not.toBeNull();
        expect(liNodes().map(n => n.textContent)).toEqual(['kept']);

        expect(() => {
            items.set([{ id: 'kept' }]);
            flushEffects();
        }).not.toThrow();
        expect(document.querySelector('ul').textContent).toBe('');
    });

    it('17. removal tolerates an entry node that is already detached', () => {
        const items = signal([{ id: 'a' }, { id: 'b' }]);
        const dispose = render(
            () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => items(),
                        item => item.id,
                        item => createElement('li', null, item().id)
                    )
                ),
            document.body
        );
        mounted.push(dispose);
        const [first] = liNodes();
        first.remove();

        expect(() => {
            items.set([{ id: 'b' }]);
            flushEffects();
        }).not.toThrow();
        expect(liNodes().map(n => n.textContent)).toEqual(['b']);
    });

    it('18. child connect can clear list anchors during insertion', () => {
        const items = signal([]);
        const tag = uniqueTag('x-for-each-clear-on-connect');

        customElements.define(
            tag,
            class extends HTMLElement {
                connectedCallback() {
                    this.parentNode?.replaceChildren();
                }
            }
        );

        const dispose = render(
            () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => items(),
                        item => item.id,
                        () => createElement(tag, null)
                    )
                ),
            document.body
        );
        mounted.push(dispose);

        expect(() => {
            items.set([{ id: 'a' }, { id: 'b' }]);
            flushEffects();
        }).not.toThrow();
        expect(document.querySelector('ul').textContent).toBe('');
    });

    it('19. final child connect can clear list anchors after insertion', () => {
        const items = signal([]);
        const tag = uniqueTag('x-for-each-clear-after-final-insert');

        customElements.define(
            tag,
            class extends HTMLElement {
                connectedCallback() {
                    this.parentNode?.replaceChildren();
                }
            }
        );

        const dispose = render(
            () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        () => items(),
                        item => item.id,
                        () => createElement(tag, null)
                    )
                ),
            document.body
        );
        mounted.push(dispose);

        expect(() => {
            items.set([{ id: 'a' }]);
            flushEffects();
        }).not.toThrow();
        expect(document.querySelector('ul').textContent).toBe('');
    });

    it('20. prepend exercises tail-trim retreat (unchanged tail stays in place)', () => {
        // Reconciler tail trim: with [b, c] → [a, b, c], head trim cannot
        // advance (newEntries[0] is the freshly-created `a`) but the tail trim
        // retreats past `c` then `b` because both are already in their final
        // DOM slots. Only `a` is left to insert.
        const items = signal([{ id: 'b' }, { id: 'c' }]);
        mount(() =>
            createElement(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => createElement('li', null, () => item().id)
                )
            )
        );
        expect(liNodes().map(n => n.textContent)).toEqual(['b', 'c']);
        const [bNode, cNode] = liNodes();

        items.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
        flushEffects();

        const after = liNodes();
        expect(after.map(n => n.textContent)).toEqual(['a', 'b', 'c']);
        // Tail-trim invariant: existing nodes are not moved, only `a` is
        // inserted before them.
        expect(after[1]).toBe(bNode);
        expect(after[2]).toBe(cNode);
    });
});
