import { describe, expect, it } from 'vitest';

import { effect, flushEffects, scope, setScheduler } from '@slimlib/store';

import { createElement, render } from '../src/index.ts';
import { queryChildren, queryChildrenRef } from '../src/query-children.ts';

setScheduler(fn => fn());

const mutationTick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('queryChildren', () => {
    it('returns current matches synchronously and updates on child mutations', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="item">a</span><span>b</span>';

        let items;
        const owner = scope(() => {
            items = queryChildren(root, '.item');
        });

        expect(items()).toEqual([root.firstElementChild]);

        const added = document.createElement('span');
        added.className = 'item';
        root.appendChild(added);
        await mutationTick();

        expect(items()).toEqual([root.firstElementChild, added]);
        owner();
    });

    it('updates when attributes change selector membership', async () => {
        const root = document.createElement('div');
        const button = document.createElement('button');
        root.appendChild(button);

        let disabled;
        const owner = scope(() => {
            disabled = queryChildren(root, '[disabled]');
        });

        expect(disabled()).toEqual([]);
        button.setAttribute('disabled', '');
        await mutationTick();
        expect(disabled()).toEqual([button]);

        button.removeAttribute('disabled');
        await mutationTick();
        expect(disabled()).toEqual([]);
        owner();
    });

    it('does not emit when mutations leave the matched element list unchanged', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="item">a</span>';

        let items;
        const runs = [];
        const owner = scope(() => {
            items = queryChildren(root, '.item');
            effect(() => {
                runs.push(items());
            });
        });
        flushEffects();

        root.firstElementChild.setAttribute('data-ignored', '1');
        await mutationTick();
        flushEffects();

        expect(runs).toHaveLength(1);
        owner();
    });

    it('updates when a matched element is replaced by another match at the same index', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<span class="item">old</span>';

        let items;
        const owner = scope(() => {
            items = queryChildren(root, '.item');
        });
        const oldItem = root.firstElementChild;
        const newItem = document.createElement('span');
        newItem.className = 'item';
        newItem.textContent = 'new';

        root.replaceChild(newItem, oldItem);
        await mutationTick();

        expect(items()).toEqual([newItem]);
        owner();
    });

    it('can observe only child mutations when requested', async () => {
        const root = document.createElement('div');
        root.innerHTML = '<span>a</span>';

        let active;
        const owner = scope(() => {
            active = queryChildren(root, '.active', { childList: true, subtree: true });
        });

        root.firstElementChild.className = 'active';
        await mutationTick();
        expect(active()).toEqual([]);

        const added = document.createElement('span');
        added.className = 'active';
        root.appendChild(added);
        await mutationTick();
        expect(active()).toEqual([root.firstElementChild, added]);
        owner();
    });

    it('disconnects when the owning scope is disposed', async () => {
        const root = document.createElement('div');
        let items;
        const owner = scope(() => {
            items = queryChildren(root, '.item');
        });

        owner();

        const added = document.createElement('span');
        added.className = 'item';
        root.appendChild(added);
        await mutationTick();

        expect(items()).toEqual([]);
    });

    it('throws synchronously for invalid selectors', () => {
        const root = document.createElement('div');
        expect(() => queryChildren(root, '[')).toThrow();
    });
});

describe('queryChildrenRef', () => {
    it('observes JSX children appended after ref setup', async () => {
        const items = queryChildrenRef('.item');
        const dispose = render(
            () => createElement('div', { ref: items.ref }, createElement('span', { class: 'item' }, 'a')),
            document.body
        );

        expect(items()).toEqual([]);
        await mutationTick();
        expect(items()).toEqual([document.querySelector('.item')]);

        dispose();
    });

    it('updates when a ref root is replaced', async () => {
        const items = queryChildrenRef('.item');
        const firstRoot = document.createElement('div');
        const secondRoot = document.createElement('div');
        firstRoot.innerHTML = '<span class="item">first</span>';
        secondRoot.innerHTML = '<span class="item">second</span>';

        items.ref(firstRoot);
        expect(items()[0].textContent).toBe('first');

        items.ref(secondRoot);
        expect(items()[0].textContent).toBe('second');

        const stale = document.createElement('span');
        stale.className = 'item';
        firstRoot.appendChild(stale);
        await mutationTick();

        expect(items()).toEqual([secondRoot.firstElementChild]);
        items.ref(null);
    });

    it('clears matches on ref null and ignores later old-root mutations', async () => {
        const items = queryChildrenRef('.item');
        const root = document.createElement('div');
        root.innerHTML = '<span class="item">first</span>';

        items.ref(root);
        expect(items()).toEqual([root.firstElementChild]);

        items.ref(null);
        expect(items()).toEqual([]);

        const added = document.createElement('span');
        added.className = 'item';
        root.appendChild(added);
        await mutationTick();

        expect(items()).toEqual([]);
    });

    it('ignores repeated refs to the same root', async () => {
        const items = queryChildrenRef('.item');
        const root = document.createElement('div');
        root.innerHTML = '<span class="item">first</span>';
        const first = root.firstElementChild;

        items.ref(root);
        items.ref(root);
        expect(items()).toEqual([first]);

        root.replaceChildren();
        root.appendChild(first);
        await mutationTick();
        expect(items()).toEqual([first]);

        items.ref(null);
    });

    it('clears matches when the render scope is disposed', async () => {
        let items;
        const dispose = render(() => {
            items = queryChildrenRef('.item');
            return createElement('div', { ref: items.ref }, createElement('span', { class: 'item' }, 'a'));
        }, document.body);
        await mutationTick();
        expect(items()).toHaveLength(1);

        dispose();
        expect(items()).toEqual([]);
    });
});
