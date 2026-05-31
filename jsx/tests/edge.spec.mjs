import { describe, expect, it } from 'vitest';

import { effect, flushEffects, setScheduler, signal } from '@slimlib/store';

import { createElement, render } from '../src/index.ts';

// Synchronous scheduler: effects run inline on creation/write. JSX itself no
// longer calls flushEffects() (full async-commit contract); tests opt into
// synchronous observation by installing a sync scheduler.
setScheduler(fn => fn());
describe('function-child transitions', () => {
    it('handles primitives, bigint, and falsy values across updates', () => {
        const root = document.createElement('div');
        const sig = signal(0);
        const dispose = render(
            () =>
                createElement('div', null, () => {
                    const v = sig();
                    if (v === 0) return 0;
                    if (v === 1) return '';
                    if (v === 2) return false;
                    if (v === 3) return null;
                    if (v === 4) return undefined;
                    if (v === 5) return true;
                    if (v === 6) return 10n;
                    return 'x';
                }),
            root
        );

        const el = root.firstChild;
        // childNodes: [startComment, textNode("0"), endComment]
        expect(el.childNodes.length).toBe(3);
        expect(el.childNodes[1].nodeType).toBe(3); // TEXT_NODE
        expect(el.childNodes[1].data).toBe('0');

        sig.set(1);
        flushEffects();
        expect(el.childNodes.length).toBe(3);
        expect(el.childNodes[1].data).toBe('');

        sig.set(2);
        flushEffects();
        expect(el.childNodes.length).toBe(2); // false → no node

        sig.set(3);
        flushEffects();
        expect(el.childNodes.length).toBe(2);

        sig.set(4);
        flushEffects();
        expect(el.childNodes.length).toBe(2);

        sig.set(5);
        flushEffects();
        expect(el.childNodes.length).toBe(2);

        sig.set(6);
        flushEffects();
        expect(el.childNodes.length).toBe(3);
        expect(el.childNodes[1].data).toBe('10'); // bigint coerced

        sig.set(10);
        flushEffects();
        expect(el.childNodes.length).toBe(3);
        expect(el.childNodes[1].data).toBe('x');

        // Fast-path round-trip after coming back from a non-primitive state.
        sig.set(0);
        flushEffects();
        expect(el.childNodes[1].data).toBe('0');

        dispose();
    });
});

// Branch-coverage tests using only the public API.
describe('branch coverage', () => {
    // applyProperty key[4]===':' gate but prefix is neither `prop` nor `attr`.
    // Such keys (e.g. `data:foo`) must fall through to the setter cache and
    // ultimately reach setAttribute, not be treated as prop:/attr:.
    it('falls through to setter cache when key has colon at index 4 but unknown prefix', () => {
        const root = document.createElement('div');
        // `data:` — looks like a namespace but is none of the known ones.
        // No proto setter exists for `data:foo` on a div, so the fallback
        // setAttribute path runs.
        const dispose = render(() => createElement('div', { 'data:foo': 'bar' }), root);
        expect(root.firstChild.getAttribute('data:foo')).toBe('bar');
        dispose();
    });

    // create-element.ts line 66: setAttrOrProp fallback path —
    // when no prototype setter is found AND value is false/null.
    // The prop must be one the proto-setter heuristic cannot resolve.
    // SVGElements don't have most HTML props as setters, but they accept attributes.
    it('removes attribute when no proto setter exists and value is null', () => {
        // 'aria-hidden' is not a writable property on HTMLDivElement — it's
        // attribute-only, so getPropSetter returns null and the fallback runs.
        const root = document.createElement('div');
        const dispose = render(() => createElement('div', { 'aria-hidden': true }), root);
        expect(root.firstChild.getAttribute('aria-hidden')).toBe('');
        dispose();

        // Now exercise the null path: prop is set, then we render with null.
        const root2 = document.createElement('div');
        const dispose2 = render(() => createElement('div', { 'aria-hidden': null }), root2);
        expect(root2.firstChild.hasAttribute('aria-hidden')).toBe(false);
        dispose2();

        // And the false path explicitly.
        const root3 = document.createElement('div');
        const dispose3 = render(() => createElement('div', { 'aria-hidden': false }), root3);
        expect(root3.firstChild.hasAttribute('aria-hidden')).toBe(false);
        dispose3();
    });

    // create-element.ts line 133-134: insertBefore Array.isArray branch.
    // Reached when a function-child returns an array.
    it('handles function-child returning an array', () => {
        const root = document.createElement('div');
        const sig = signal(0);
        const dispose = render(
            () =>
                createElement('div', null, () => {
                    const v = sig();
                    return [createElement('span', null, `a${v}`), createElement('span', null, `b${v}`)];
                }),
            root
        );

        const el = root.firstChild;
        // start, span(a0), span(b0), end
        expect(el.childNodes.length).toBe(4);
        expect(el.childNodes[1].textContent).toBe('a0');
        expect(el.childNodes[2].textContent).toBe('b0');

        sig.set(1);
        flushEffects();
        expect(el.childNodes.length).toBe(4);
        expect(el.childNodes[1].textContent).toBe('a1');
        expect(el.childNodes[2].textContent).toBe('b1');

        dispose();
    });

    // create-element.ts line 141-142: insertBefore function branch.
    // Reached when a function-child returns another function (nested thunk).
    it('handles function-child returning a nested function', () => {
        const root = document.createElement('div');
        const sig = signal(0);
        const dispose = render(
            () =>
                createElement('div', null, () => {
                    // outer effect returns an inner thunk — insertBefore
                    // unwraps the function child.
                    const v = sig();
                    return () => `nested:${v}`;
                }),
            root
        );

        const el = root.firstChild;
        expect(el.textContent).toBe('nested:0');

        sig.set(1);
        flushEffects();
        // Note: the inner thunk runs once per outer effect run; not reactive
        // independently because it's read eagerly by insertBefore.
        expect(el.textContent).toBe('nested:1');

        dispose();
    });

    // create-element.ts: insertBefore null/false/true bailout.
    // Reached when a function-child returns null/false/true (no node inserted).
    // Already covered by the falsy-children test above for `false/null/undefined/true`,
    // but that uses appendChild path. Add the insertBefore path via array of nulls.
    it('handles function-child returning array with null/false/true entries', () => {
        const root = document.createElement('div');
        const dispose = render(() => createElement('div', null, () => [null, false, true, 'visible']), root);
        const el = root.firstChild;
        // start, text("visible"), end
        expect(el.childNodes.length).toBe(3);
        expect(el.childNodes[1].textContent).toBe('visible');
        dispose();
    });
});

// jsx-runtime branch coverage: array children vs single child vs undefined.
describe('jsx-runtime branches', () => {
    it('handles array, single, and missing children', async () => {
        const { jsx } = await import('../src/jsx-runtime.ts');

        // Array children branch.
        const a = jsx('div', { children: [jsx('span', { children: '1' }), jsx('span', { children: '2' })] });
        expect(a.childNodes.length).toBe(2);
        expect(a.textContent).toBe('12');

        // Single (non-array) child branch.
        const b = jsx('div', { children: jsx('span', { children: 'solo' }) });
        expect(b.childNodes.length).toBe(1);
        expect(b.textContent).toBe('solo');

        // Undefined children branch.
        const c = jsx('div', {});
        expect(c.childNodes.length).toBe(0);
    });
});

// Coverage for forced attribute path and children-prop iteration skip.
describe('attribute prefix + children-in-props', () => {
    // create-element.ts L58-59: 'attr:' forced attribute path with all
    // value shapes: false/null (remove), true (empty string), other (String()).
    it('attr: forces attribute setter regardless of proto', () => {
        // Use 'attr:' on a property that DOES have a prototype setter
        // ('id' is a DOMString reflected prop); this forces the attribute path.
        const root1 = document.createElement('div');
        const d1 = render(() => createElement('div', { 'attr:id': 'foo' }), root1);
        expect(root1.firstChild.getAttribute('id')).toBe('foo');
        d1();

        const root2 = document.createElement('div');
        const d2 = render(() => createElement('div', { 'attr:id': true }), root2);
        expect(root2.firstChild.getAttribute('id')).toBe('');
        d2();

        const root3 = document.createElement('div');
        const d3 = render(() => createElement('div', { 'attr:id': null }), root3);
        expect(root3.firstChild.hasAttribute('id')).toBe(false);
        d3();

        const root4 = document.createElement('div');
        const d4 = render(() => createElement('div', { 'attr:id': false }), root4);
        expect(root4.firstChild.hasAttribute('id')).toBe(false);
        d4();
    });

    // create-element.ts L166: 'children' key in props is skipped during
    // for-in over props. Reached when calling createElement with an
    // explicit 'children' prop (as JSX runtime does).
    it('skips children entry when iterating props', async () => {
        const { jsx } = await import('../src/jsx-runtime.ts');
        // jsx passes the full props object (including 'children') to
        // createElement; the for-in loop must NOT try to set 'children'
        // as a DOM attribute.
        const el = jsx('div', { id: 'x', children: jsx('span', { children: 'hi' }) });
        expect(el.getAttribute('id')).toBe('x');
        expect(el.textContent).toBe('hi');
        // Verify 'children' attribute was NOT applied.
        expect(el.hasAttribute('children')).toBe(false);
    });

    // create-element.ts L40 + L26: getPropSetter caches `null` when the property
    // descriptor exists but has no setter (getter-only / read-only). Reached
    // by attempting to set a read-only DOM property like 'tagName'.
    it('falls back to setAttribute for read-only DOM properties', () => {
        const el = createElement('div', { tagName: 'CUSTOM' });
        // tagName is a getter-only inherited property on Element, so the
        // renderer falls back to setAttribute('tagName', 'CUSTOM').
        expect(el.getAttribute('tagName')).toBe('CUSTOM');
        // Sanity: the actual tagName is unchanged.
        expect(el.tagName).toBe('DIV');

        // Second call hits the cached `null` branch — exercises the cache
        // hit on the read-only path.
        const el2 = createElement('div', { tagName: 'AGAIN' });
        expect(el2.getAttribute('tagName')).toBe('AGAIN');
    });

    // create-element.ts L26: registerCleanup no-op branch when there is no
    // active onDispose context. createElement called outside of render()
    // has currentOnDispose === null, so on:/ref cleanup is skipped (no leak
    // because there's no scope to leak into).
    it('on:/ref outside render() do not register cleanup (no-op)', () => {
        let clicks = 0;
        const onClick = () => {
            clicks++;
        };
        // No render() wrapper → currentOnDispose === null.
        const el = createElement('button', { 'on:click': onClick });
        el.click();
        expect(clicks).toBe(1);

        let refVal = null;
        const refCb = e => {
            refVal = e;
        };
        const el2 = createElement('div', { ref: refCb });
        expect(refVal).toBe(el2);
    });

    // create-element.ts L76: 'on:' with non-function value is silently ignored.
    it('on: with non-function value is a no-op', () => {
        const el = createElement('button', { 'on:click': null });
        // No throw; no listener attached. Click should not crash.
        el.click();
        expect(el.tagName).toBe('BUTTON');

        const el2 = createElement('button', { 'on:click': 'not-a-fn' });
        el2.click();
        expect(el2.tagName).toBe('BUTTON');
    });

    // create-element.ts L83: 'ref' with non-function value is silently ignored.
    it('ref with non-function value is a no-op', () => {
        const el = createElement('div', { ref: null });
        // No throw; no callback invoked.
        expect(el.tagName).toBe('DIV');

        const el2 = createElement('div', { ref: 'not-a-fn' });
        expect(el2.tagName).toBe('DIV');
    });
});

// Sub-scope per dynamic boundary: a function-child must dispose its previous
// subtree (effects, on:* listeners, ref(null) callbacks) when it re-runs.
describe('sub-scope per dynamic boundary', () => {
    it('disposes inner effect when conditional swaps it away', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        const inner = signal(0);
        let effectRuns = 0;

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    cond()
                        ? createElement('span', null, () => {
                              effectRuns++;
                              return inner();
                          })
                        : createElement('p', null, 'off')
                ),
            root
        );

        flushEffects();
        const initial = effectRuns;
        expect(initial).toBeGreaterThan(0);

        inner.set(1);
        flushEffects();
        expect(effectRuns).toBe(initial + 1);

        cond.set(false);
        flushEffects();
        const afterSwap = effectRuns;

        // Writing to `inner` should NOT re-run the disposed inner effect.
        inner.set(2);
        flushEffects();
        inner.set(3);
        flushEffects();
        expect(effectRuns).toBe(afterSwap);

        dispose();
    });

    it('removes event listener when conditional swaps the button away', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        let clicks = 0;
        const handler = () => {
            clicks++;
        };

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    cond() ? createElement('button', { 'on:click': handler }, 'go') : createElement('p', null, 'off')
                ),
            root
        );

        flushEffects();
        const outer = root.firstChild;
        // Capture the button reference before the swap.
        const btn = Array.from(outer.childNodes).find(n => n.nodeName === 'BUTTON');
        expect(btn).toBeDefined();
        btn.click();
        expect(clicks).toBe(1);

        cond.set(false);
        flushEffects();

        // The detached button must no longer fire the handler.
        btn.click();
        expect(clicks).toBe(1);

        dispose();
    });

    it('calls ref(null) when conditional swaps the ref-bearing node away', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        const refCalls = [];
        const refCb = e => {
            refCalls.push(e);
        };

        const dispose = render(
            () => createElement('div', null, () => (cond() ? createElement('span', { ref: refCb }, 'x') : createElement('p', null, 'off'))),
            root
        );

        flushEffects();
        expect(refCalls.length).toBe(1);
        expect(refCalls[0]).not.toBeNull();
        const span = refCalls[0];
        expect(span.nodeName).toBe('SPAN');

        cond.set(false);
        flushEffects();
        expect(refCalls.length).toBe(2);
        expect(refCalls[1]).toBeNull();

        dispose();
    });

    it('disposes nested conditional inner effects when outer flips', () => {
        const root = document.createElement('div');
        const condA = signal(true);
        const condB = signal(true);
        const leaf = signal(0);
        let leafRuns = 0;

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    condA()
                        ? createElement('div', null, () =>
                              condB()
                                  ? createElement('span', null, () => {
                                        leafRuns++;
                                        return leaf();
                                    })
                                  : createElement('em', null, 'b-off')
                          )
                        : createElement('p', null, 'a-off')
                ),
            root
        );

        flushEffects();
        flushEffects();
        flushEffects();
        const initial = leafRuns;
        expect(initial).toBeGreaterThan(0);

        // Outer flip should dispose both the inner condB switcher AND the leaf.
        condA.set(false);
        flushEffects();
        flushEffects();
        const afterFlip = leafRuns;

        // Writing to either inner signal must NOT cause re-runs.
        leaf.set(1);
        flushEffects();
        condB.set(false);
        flushEffects();
        leaf.set(2);
        flushEffects();
        expect(leafRuns).toBe(afterFlip);

        dispose();
    });

    // Regression: dispose() the whole render while a sub-scope is alive.
    // The top-level dispose must tear down nested sub-scopes — effects, event
    // listeners, and ref callbacks — without first having to flip the
    // conditional. Locks the contract the implementation already satisfies.
    it('dispose() tears down live sub-scope (effects, listeners, refs)', () => {
        const root = document.createElement('div');
        const inner = signal(0);
        let effectRuns = 0;
        let clicks = 0;
        const refCalls = [];

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    createElement(
                        'button',
                        {
                            'on:click': () => {
                                clicks++;
                            },
                            ref: e => {
                                refCalls.push(e);
                            },
                        },
                        () => {
                            effectRuns++;
                            return inner();
                        }
                    )
                ),
            root
        );

        flushEffects();
        const btn = Array.from(root.firstChild.childNodes).find(n => n.nodeName === 'BUTTON');
        expect(btn).toBeDefined();
        const initialRuns = effectRuns;
        expect(initialRuns).toBeGreaterThan(0);
        expect(refCalls.length).toBe(1);
        expect(refCalls[0]).toBe(btn);

        btn.click();
        expect(clicks).toBe(1);

        // Dispose while everything is alive. No prior cond flip.
        dispose();

        // ref(null) must have fired.
        expect(refCalls.length).toBe(2);
        expect(refCalls[1]).toBeNull();

        // Detached button must no longer fire the handler.
        btn.click();
        expect(clicks).toBe(1);

        // Writing to inner must NOT re-run the disposed effect.
        inner.set(1);
        flushEffects();
        inner.set(2);
        flushEffects();
        expect(effectRuns).toBe(initialRuns);
    });
});

// Lock the conditional-render cleanup contract. These cases should already
// pass on top of the sub-scope wiring from item #2; failures here indicate a
// real bug in `currentOnDispose` / sub-scope teardown — not a missing feature.
describe('conditional render cleanup contract', () => {
    it('swap back to truthy creates a fresh sub-scope (old node detached, new node live)', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        let clicks = 0;
        const handler = () => {
            clicks++;
        };

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    cond() ? createElement('span', { 'on:click': handler }, 'on') : createElement('p', null, 'off')
                ),
            root
        );

        flushEffects();
        const outer = root.firstChild;
        const oldSpan = Array.from(outer.childNodes).find(n => n.nodeName === 'SPAN');
        expect(oldSpan).toBeDefined();
        oldSpan.click();
        expect(clicks).toBe(1);

        cond.set(false);
        flushEffects();
        cond.set(true);
        flushEffects();

        const newSpan = Array.from(outer.childNodes).find(n => n.nodeName === 'SPAN');
        expect(newSpan).toBeDefined();
        expect(newSpan).not.toBe(oldSpan);

        // The OLD span's listener must have been torn down by the first swap.
        oldSpan.click();
        expect(clicks).toBe(1);

        // The NEW span has a fresh listener registered in the new sub-scope.
        newSpan.click();
        expect(clicks).toBe(2);

        dispose();
    });

    it('user effect cleanup runs on re-run and on sub-scope dispose', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        const sig = signal(0);
        const cleanups = [];

        const MyComponent = () => {
            effect(() => {
                sig();
                return () => {
                    cleanups.push('cleaned');
                };
            });
            return createElement('span', null, 'c');
        };

        const dispose = render(() => createElement('div', null, () => (cond() ? createElement(MyComponent, null) : 'off')), root);

        flushEffects();
        // First run done; cleanup does not fire on first run.
        expect(cleanups).toEqual([]);

        // Re-run via signal write: previous run's cleanup fires.
        sig.set(1);
        flushEffects();
        expect(cleanups).toEqual(['cleaned']);

        // Flip outer cond off: sub-scope tears down, current run's cleanup fires.
        cond.set(false);
        flushEffects();
        expect(cleanups).toEqual(['cleaned', 'cleaned']);

        // After teardown, further sig writes must not re-run the effect.
        sig.set(2);
        flushEffects();
        expect(cleanups).toEqual(['cleaned', 'cleaned']);

        dispose();
    });

    it('removes multiple listeners on the same node when conditional swaps it away', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        let clicks = 0;
        let overs = 0;
        const h1 = () => {
            clicks++;
        };
        const h2 = () => {
            overs++;
        };

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    cond() ? createElement('button', { 'on:click': h1, 'on:mouseover': h2 }, 'go') : createElement('p', null, 'off')
                ),
            root
        );

        flushEffects();
        const btn = Array.from(root.firstChild.childNodes).find(n => n.nodeName === 'BUTTON');
        expect(btn).toBeDefined();
        btn.click();
        btn.dispatchEvent(new Event('mouseover'));
        expect(clicks).toBe(1);
        expect(overs).toBe(1);

        cond.set(false);
        flushEffects();

        // Both listeners must have been removed on swap.
        btn.click();
        btn.dispatchEvent(new Event('mouseover'));
        expect(clicks).toBe(1);
        expect(overs).toBe(1);

        dispose();
    });

    it('nulls refs on both outer and inner nodes when outer conditional flips', () => {
        const root = document.createElement('div');
        const cond = signal(true);
        const outerCalls = [];
        const innerCalls = [];
        const refOuter = e => {
            outerCalls.push(e);
        };
        const refInner = e => {
            innerCalls.push(e);
        };

        const dispose = render(
            () =>
                createElement('div', null, () =>
                    cond() ? createElement('span', { ref: refOuter }, createElement('em', { ref: refInner })) : null
                ),
            root
        );

        flushEffects();
        expect(outerCalls.length).toBe(1);
        expect(innerCalls.length).toBe(1);
        expect(outerCalls[0]?.nodeName).toBe('SPAN');
        expect(innerCalls[0]?.nodeName).toBe('EM');

        cond.set(false);
        flushEffects();

        expect(outerCalls.length).toBe(2);
        expect(innerCalls.length).toBe(2);
        expect(outerCalls[1]).toBeNull();
        expect(innerCalls[1]).toBeNull();

        dispose();
    });
});
