import { afterEach, describe, expect, it, vi } from 'vitest';

import { setScheduler } from '@slimlib/store';

vi.mock('esm-env', () => ({ DEV: false }));

setScheduler(scheduledCallback => scheduledCallback());

let counter = 0;
const uniqueTag = baseName => `${baseName}-${++counter}`;
const supportsCustomizedBuiltIns = () => {
    const tag = uniqueTag('x-slim-built-in-prod-probe');
    try {
        class ProbeButton extends HTMLButtonElement {}
        customElements.define(tag, ProbeButton, { extends: 'button' });
        return document.createElement('button', { is: tag }) instanceof ProbeButton;
    } catch {
        return false;
    }
};

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
        const ElementConstructor = customElements.get(tag);

        expect(ElementConstructor.name).toBe('');
        expect(customElements.get(tag)).toBe(ElementConstructor);
    });

    const customizedBuiltInIt = supportsCustomizedBuiltIns() ? it : it.skip;
    customizedBuiltInIt('uses an anonymous customized built-in constructor', async () => {
        const { defineBuiltinElement } = await import('../src/index.js');

        const tag = uniqueTag('x-slim-button-prod');
        defineBuiltinElement(tag, 'button', () => null);
        const ElementConstructor = customElements.get(tag);
        const element = document.createElement('button', { is: tag });

        expect(ElementConstructor.name).toBe('');
        expect(element).toBeInstanceOf(ElementConstructor);
    });
});

describe('attributes() reflection (production)', () => {
    it('reflects a Number prop without emitting DEV warnings', async () => {
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tag = uniqueTag('x-attr-reflect-prod');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
            props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.count = 9;
        expect(element.getAttribute('count')).toBe('9');
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('does not warn for an undeclared reflected key in production', async () => {
        const { defineElement, attributes, stringAttr } = await import('../src/index.js');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tag = uniqueTag('x-attr-undeclared-prod');
        defineElement(tag, [attributes({ ghost: stringAttr })], () => null);

        document.body.appendChild(document.createElement(tag));

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
