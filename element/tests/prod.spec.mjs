import { afterEach, describe, expect, it, vi } from 'vitest';

import { setScheduler } from '@slimlib/store';

vi.mock('esm-env', () => ({ DEV: false }));

setScheduler(fn => fn());

let counter = 0;
const uniqueTag = base => `${base}-${++counter}`;

afterEach(() => {
    document.body.innerHTML = '';
});

describe('props() (production)', () => {
    it('does not throw when called inside a render callback', async () => {
        const { defineElement, props } = await import('../src/index.js');

        const tag = uniqueTag('x-props-prod');
        defineElement(tag, () => {
            props({ x: 1 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        expect(element.x).toBe(1);
    });

    it('does not throw when called outside a render callback (DEV check is gone)', async () => {
        const { props } = await import('../src/index.js');
        // In production, props() must not perform the DEV-only "outside render" check.
        // Calling it with no current host installs accessors on `undefined` and throws
        // a TypeError from Object.defineProperty — not the friendly DEV error.
        expect(() => props({ x: 1 })).not.toThrow(/must be called synchronously inside/);
    });
});

describe('defineElement constructor naming (production)', () => {
    it('uses an anonymous constructor', async () => {
        const { defineElement } = await import('../src/index.js');

        const tag = uniqueTag('x-slim-counter-prod');
        defineElement(tag, () => null);
        const Element = customElements.get(tag);

        expect(Element.name).toBe('');
        expect(customElements.get(tag)).toBe(Element);
    });
});
