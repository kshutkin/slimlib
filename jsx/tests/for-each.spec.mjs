// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushEffects, setScheduler, signal } from '@slimlib/store';

import { forEach } from '../src/for-each.js';
import { createElement, render } from '../src/index.js';

// Synchronous scheduler: effects run inline on creation/write. JSX itself no
// longer calls flushEffects() (full async-commit contract); tests opt into
// synchronous observation by installing a sync scheduler.
setScheduler(fn => fn());

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
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        );
        const errs = errSpy.mock.calls.flat();
        errSpy.mockRestore();
        expect(errs.some(e => e instanceof Error && /single Node/.test(e.message))).toBe(true);
    });
});
