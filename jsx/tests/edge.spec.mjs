/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { flushEffects, signal } from '@slimlib/store';

import { createElement, render } from '../src/index.js';

// Function-child transitions through the fast-path / slow-path branches.
// render() is required because @slimlib/store effects are batched and only
// run after flushEffects(), which render() calls.
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
        const { jsx } = await import('../src/jsx-runtime.js');

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
        const { jsx } = await import('../src/jsx-runtime.js');
        // jsx passes the full props object (including 'children') to
        // createElement; the for-in loop must NOT try to set 'children'
        // as a DOM attribute.
        const el = jsx('div', { id: 'x', children: jsx('span', { children: 'hi' }) });
        expect(el.getAttribute('id')).toBe('x');
        expect(el.textContent).toBe('hi');
        // Verify 'children' attribute was NOT applied.
        expect(el.hasAttribute('children')).toBe(false);
    });

    // Same skip, but via createElement directly with 'children' in props.
    // jsx-runtime strips children from props via destructuring, so to hit
    // the L166 continue branch we have to call createElement directly.
    it('createElement skips a children prop', () => {
        // createElement signature: (type, props, ...children)
        // When props contains a 'children' key, it must be skipped.
        const el = createElement('div', { id: 'y', children: 'ignored-via-prop' }, 'real');
        expect(el.getAttribute('id')).toBe('y');
        // The literal 'real' is the actual child (positional arg), not the prop.
        expect(el.textContent).toBe('real');
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
