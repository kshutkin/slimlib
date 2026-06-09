import { afterEach, describe, expect, it } from 'vitest';

import { flushEffects, setScheduler, signal } from '@slimlib/store';

import { createContext, getContext, provideContext } from '../src/context.ts';
import { forEach } from '../src/for-each.ts';
import { createElement, render } from '../src/index.ts';

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

describe('context', () => {
    it('returns the default value outside a provider', () => {
        const Label = createContext('fallback');
        expect(getContext(Label)).toBe('fallback');
    });

    it('provides a value while building a lazy subtree', () => {
        const Label = createContext('fallback');
        const Child = () => createElement('span', null, getContext(Label));

        mount(() => provideContext(Label, 'provided', () => createElement('div', null, createElement(Child, null))));

        expect(document.body.textContent).toBe('provided');
        expect(getContext(Label)).toBe('fallback');
    });

    it('restores nested provider values', () => {
        const Label = createContext('fallback');
        const Child = () => createElement('span', null, getContext(Label));

        mount(() =>
            provideContext(Label, 'outer', () =>
                createElement(
                    'div',
                    null,
                    createElement(Child, null),
                    provideContext(Label, 'inner', () => createElement(Child, null)),
                    createElement(Child, null)
                )
            )
        );

        expect(Array.from(document.querySelectorAll('span')).map(node => node.textContent)).toEqual(['outer', 'inner', 'outer']);
    });

    it('restores context for components built by function-child reruns', () => {
        const Label = createContext('fallback');
        const show = signal(false);
        const Child = () => createElement('span', null, getContext(Label));

        mount(() => provideContext(Label, 'provided', () => createElement('div', null, () => (show() ? createElement(Child, null) : null))));
        expect(document.body.textContent).toBe('');

        show.set(true);
        flushEffects();
        expect(document.body.textContent).toBe('provided');
    });

    it('restores context for reactive prop reruns', () => {
        const Label = createContext('fallback');
        const tick = signal(0);

        mount(() =>
            provideContext(Label, 'provided', () =>
                createElement('div', {
                    className: () => {
                        tick();
                        return getContext(Label);
                    },
                })
            )
        );

        const div = document.querySelector('div');
        expect(div.className).toBe('provided');
        tick.set(1);
        flushEffects();
        expect(div.className).toBe('provided');
    });

    it('restores context for forEach rows created after initial render', () => {
        const Label = createContext('fallback');
        const items = signal([{ id: 1 }]);

        mount(() =>
            provideContext(Label, 'provided', () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        items,
                        item => item.id,
                        item => createElement('li', null, `${getContext(Label)}:${item().id}`)
                    )
                )
            )
        );

        expect(Array.from(document.querySelectorAll('li')).map(node => node.textContent)).toEqual(['provided:1']);
        items.set([{ id: 1 }, { id: 2 }]);
        flushEffects();
        expect(Array.from(document.querySelectorAll('li')).map(node => node.textContent)).toEqual(['provided:1', 'provided:2']);
    });
});
