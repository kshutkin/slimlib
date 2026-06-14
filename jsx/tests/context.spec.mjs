import { afterEach, describe, expect, it } from 'vitest';

import { flushEffects, scope, setScheduler, signal } from '@slimlib/store';

import { forEach } from '../src/for-each.ts';
import { createContext, createElement, inject, Provider, render } from '../src/index.ts';

setScheduler(fn => fn());

let mounted = [];
afterEach(() => {
    for (const dispose of mounted) dispose();
    mounted = [];
    document.body.innerHTML = '';
});

const mount = factory => {
    const dispose = render(factory, document.body);
    mounted.push(dispose);
    return dispose;
};

describe('context', () => {
    it('returns undefined when no provider is found', () => {
        const Label = createContext();
        expect(inject(Label)).toBeUndefined();
    });

    it('provides values to descendant components', () => {
        const Label = createContext();
        const Child = () => createElement('span', null, inject(Label));

        mount(() =>
            createElement(Provider, { context: Label, value: 'provided' }, () => createElement('div', null, createElement(Child, null)))
        );

        expect(document.body.textContent).toBe('provided');
    });

    it('keeps sibling component providers isolated', () => {
        const Label = createContext();
        const Child = () => createElement('span', null, inject(Label) ?? 'empty');

        mount(() =>
            createElement(
                'div',
                null,
                createElement(Provider, { context: Label, value: 'provided' }, () => createElement(Child, null)),
                createElement(Child, null)
            )
        );

        expect(Array.from(document.querySelectorAll('span')).map(node => node.textContent)).toEqual(['provided', 'empty']);
    });

    it('uses the nearest provider value', () => {
        const Label = createContext();
        const Child = () => createElement('span', null, inject(Label));
        const Outer = () => {
            return createElement(Provider, { context: Label, value: 'outer' }, () =>
                createElement('div', null, createElement(Child, null), createElement(Inner, null), createElement(Child, null))
            );
        };
        const Inner = () => {
            return createElement(Provider, { context: Label, value: 'inner' }, () => createElement(Child, null));
        };

        mount(() => createElement(Outer, null));

        expect(Array.from(document.querySelectorAll('span')).map(node => node.textContent)).toEqual(['outer', 'inner', 'outer']);
    });

    it('restores context for function-child reruns', () => {
        const Label = createContext();
        const show = signal(false);
        const Child = () => createElement('span', null, inject(Label));

        mount(() =>
            createElement(Provider, { context: Label, value: 'provided' }, () =>
                createElement('div', null, () => (show() ? createElement(Child, null) : null))
            )
        );
        expect(document.body.textContent).toBe('');

        show.set(true);
        flushEffects();
        expect(document.body.textContent).toBe('provided');
    });

    it('restores context for reactive prop reruns', () => {
        const Label = createContext();
        const tick = signal(0);
        const Child = () =>
            createElement('div', {
                className: () => {
                    tick();
                    return inject(Label);
                },
            });

        mount(() => createElement(Provider, { context: Label, value: 'provided' }, () => createElement(Child, null)));

        const div = document.querySelector('div');
        expect(div.className).toBe('provided');
        tick.set(1);
        flushEffects();
        expect(div.className).toBe('provided');
    });

    it('restores context for forEach rows created after initial render', () => {
        const Label = createContext();
        const items = signal([{ id: 1 }]);
        mount(() =>
            createElement(Provider, { context: Label, value: 'provided' }, () =>
                createElement(
                    'ul',
                    null,
                    forEach(
                        items,
                        item => item.id,
                        item => createElement('li', null, `${inject(Label)}:${item().id}`)
                    )
                )
            )
        );

        expect(Array.from(document.querySelectorAll('li')).map(node => node.textContent)).toEqual(['provided:1']);
        items.set([{ id: 1 }, { id: 2 }]);
        flushEffects();
        expect(Array.from(document.querySelectorAll('li')).map(node => node.textContent)).toEqual(['provided:1', 'provided:2']);
    });

    it('throws in DEV when provider children is not a function', () => {
        const Label = createContext();

        expect(() => mount(() => createElement(Provider, { context: Label, value: 'provided' }, createElement('span', null)))).toThrow(
            /children must be a function/
        );
    });

    it('throws in DEV when provider thunk runs outside a scope', () => {
        const Label = createContext();
        const child = Provider({ context: Label, value: 'provided', children: () => null });

        expect(() => child()).toThrow(/inside a scope/);
    });

    it('can provide multiple values in one active scope', () => {
        const Label = createContext();
        const Count = createContext();
        const labelChild = Provider({ context: Label, value: 'provided', children: () => null });
        const countChild = Provider({ context: Count, value: 1, children: () => null });
        const owner = scope(() => {
            labelChild();
            countChild();

            expect(inject(Label)).toBe('provided');
            expect(inject(Count)).toBe(1);
        });

        owner();
    });
});
