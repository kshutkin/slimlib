/**
 * @vitest-environment jsdom
 */
import { flushEffects, signal } from '@slimlib/store';
import { describe, expect, it } from 'vitest';
import { createElement } from '../src/create-element.ts';
import { render } from '../src/render.ts';

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
            root,
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
