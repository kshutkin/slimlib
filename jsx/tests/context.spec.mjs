import { afterEach, describe, expect, it } from 'vitest';

import { flushEffects, scope, setScheduler, signal } from '@slimlib/store';

import { forEach } from '../src/for-each.ts';
import { createContext, createElement, inject, Provider, RootProvider, render } from '../src/index.ts';

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

    it('returns undefined when the provider chain does not contain the requested context', () => {
        const Label = createContext();
        const Missing = createContext();
        const Child = () => createElement('span', null, inject(Missing) ?? 'empty');

        mount(() =>
            createElement(Provider, { context: Label, value: 'provided' }, () => createElement('div', null, createElement(Child, null)))
        );

        expect(document.body.textContent).toBe('empty');
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

    it('allows undefined to shadow an outer provider value', () => {
        const Label = createContext();
        const Child = () => createElement('span', null, inject(Label) === undefined ? 'empty' : 'provided');

        mount(() =>
            createElement(Provider, { context: Label, value: 'outer' }, () =>
                createElement(Provider, { context: Label, value: undefined }, () => createElement(Child, null))
            )
        );

        expect(document.body.textContent).toBe('empty');
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

describe('RootProvider', () => {
    it('provides a default when no ancestor provides the context', () => {
        const Theme = createContext();
        let calls = 0;
        const Child = () => createElement('span', null, inject(Theme) ?? 'empty');

        mount(() =>
            createElement(
                RootProvider,
                {
                    context: Theme,
                    factory: () => {
                        ++calls;
                        return 'root';
                    },
                },
                () => createElement(Child, null)
            )
        );

        expect(document.body.textContent).toBe('root');
        expect(calls).toBe(1);
    });

    it('defers to an ancestor provider and skips its factory', () => {
        const Theme = createContext();
        let calls = 0;
        const Child = () => createElement('span', null, inject(Theme));

        mount(() =>
            createElement(Provider, { context: Theme, value: 'ancestor' }, () =>
                createElement(
                    RootProvider,
                    {
                        context: Theme,
                        factory: () => {
                            ++calls;
                            return 'root';
                        },
                    },
                    () => createElement(Child, null)
                )
            )
        );

        expect(document.body.textContent).toBe('ancestor');
        expect(calls).toBe(0);
    });

    it('provides only at the top-most of nested RootProviders', () => {
        const Service = createContext();
        let outerCalls = 0;
        let innerCalls = 0;
        const Child = () => createElement('span', null, inject(Service));

        mount(() =>
            createElement(
                RootProvider,
                {
                    context: Service,
                    factory: () => {
                        ++outerCalls;
                        return 'outer';
                    },
                },
                () =>
                    createElement(
                        RootProvider,
                        {
                            context: Service,
                            factory: () => {
                                ++innerCalls;
                                return 'inner';
                            },
                        },
                        () => createElement(Child, null)
                    )
            )
        );

        expect(document.body.textContent).toBe('outer');
        expect(outerCalls).toBe(1);
        expect(innerCalls).toBe(0);
    });

    it('creates an independent root value for each sibling RootProvider', () => {
        const Instance = createContext();
        let calls = 0;
        const Child = () => createElement('span', null, inject(Instance));

        mount(() =>
            createElement(
                'div',
                null,
                createElement(RootProvider, { context: Instance, factory: () => `id-${++calls}` }, () => createElement(Child, null)),
                createElement(RootProvider, { context: Instance, factory: () => `id-${++calls}` }, () => createElement(Child, null))
            )
        );

        expect(Array.from(document.querySelectorAll('span')).map(node => node.textContent)).toEqual(['id-1', 'id-2']);
        expect(calls).toBe(2);
    });

    it('respects an ancestor that provides undefined and stays transparent', () => {
        const Label = createContext();
        let calls = 0;
        const Child = () => createElement('span', null, inject(Label) === undefined ? 'empty' : inject(Label));

        mount(() =>
            createElement(Provider, { context: Label, value: undefined }, () =>
                createElement(
                    RootProvider,
                    {
                        context: Label,
                        factory: () => {
                            ++calls;
                            return 'root';
                        },
                    },
                    () => createElement(Child, null)
                )
            )
        );

        expect(document.body.textContent).toBe('empty');
        expect(calls).toBe(0);
    });

    it('keeps the factory memoized when its subtree re-renders', () => {
        const Theme = createContext();
        const count = signal(0);
        let calls = 0;
        // `count()` is read synchronously inside the provider's child subtree, so
        // the RootProvider thunk itself re-runs on change (not just a nested thunk).
        const Child = () => createElement('span', null, `${inject(Theme)}:${count()}`);

        mount(() =>
            createElement(
                RootProvider,
                {
                    context: Theme,
                    factory: () => {
                        ++calls;
                        return 'root';
                    },
                },
                () => createElement(Child, null)
            )
        );

        expect(document.body.textContent).toBe('root:0');
        expect(calls).toBe(1);

        count.set(1);
        flushEffects();
        expect(document.body.textContent).toBe('root:1');
        expect(calls).toBe(1);
    });

    it('throws in DEV when RootProvider children is not a function', () => {
        const Label = createContext();

        expect(() =>
            mount(() => createElement(RootProvider, { context: Label, factory: () => 'root' }, createElement('span', null)))
        ).toThrow(/children must be a function/);
    });

    it('throws in DEV when RootProvider thunk runs outside a scope', () => {
        const Label = createContext();
        const child = RootProvider({ context: Label, factory: () => 'root', children: () => null });

        expect(() => child()).toThrow(/inside a scope/);
    });
});
