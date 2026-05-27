import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.hoisted(() => vi.fn());

vi.mock('@slimlib/jsx', () => ({ render }));

const nextMicrotask = () => Promise.resolve();

const importElement = async (dev = true) => {
    vi.resetModules();
    vi.doMock('esm-env', () => ({ DEV: dev }));
    return import('../src/index.js');
};

describe('element', () => {
    beforeEach(() => {
        render.mockReset();
        vi.stubGlobal(
            'HTMLElement',
            class {
                isConnected = false;
            }
        );
        vi.stubGlobal('customElements', { define: vi.fn() });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.doUnmock('esm-env');
    });

    it('smoke', async () => {
        // signature: (tag, render) | (tag, attrs, render)
        const { defineElement, props } = await importElement();

        expect(typeof defineElement).toBe('function');
        expect(typeof props).toBe('function');
    });

    it('attributeChangedCallback sets the named property on the host', async () => {
        const { defineElement } = await importElement();

        const Element = defineElement('x-slim-attrs', ['value'], () => null);
        const element = new Element();

        element.attributeChangedCallback('value', null, 'hello');

        expect(element.value).toBe('hello');
    });

    it('props() throws outside a render callback in DEV mode', async () => {
        const { props } = await importElement(true);

        expect(() => props({ count: 0 })).toThrow(
            'props() must be called synchronously inside a defineElement render callback'
        );
    });

    it('props() installs reactive accessors that read and write through the state proxy', async () => {
        render.mockImplementationOnce(factory => {
            factory();
            return vi.fn();
        });
        const { defineElement, props } = await importElement(true);
        let reactiveState;
        const Element = defineElement('x-props-rw', () => {
            reactiveState = props({ count: 42 });
            return null;
        });
        const element = new Element();
        element.isConnected = true;
        element.connectedCallback();

        expect(element.count).toBe(42);
        expect(reactiveState.count).toBe(42);

        element.count = 99;
        expect(element.count).toBe(99);
        expect(reactiveState.count).toBe(99);

        reactiveState.count = 7;
        expect(element.count).toBe(7);
    });

    it('props() adopts own properties already present on the host before connect', async () => {
        render.mockImplementationOnce(factory => {
            factory();
            return vi.fn();
        });
        const { defineElement, props } = await importElement(true);
        let reactiveState;
        const Element = defineElement('x-props-adopt', ['value'], () => {
            reactiveState = props({ value: 'default' });
            return null;
        });
        const element = new Element();

        // Simulate browser setting the attribute before the element connects.
        element.attributeChangedCallback('value', null, 'hello');
        expect(element.value).toBe('hello');

        element.isConnected = true;
        element.connectedCallback();

        // props() should have adopted the pre-set 'hello' value.
        expect(element.value).toBe('hello');
        expect(reactiveState.value).toBe('hello');
    });

    it('props() works in production mode without throwing', async () => {
        render.mockImplementationOnce(factory => {
            factory();
            return vi.fn();
        });
        const { defineElement, props } = await importElement(false);
        const Element = defineElement('x-props-prod', () => {
            props({ x: 1 });
            return null;
        });
        const element = new Element();
        element.isConnected = true;
        element.connectedCallback();

        expect(element.x).toBe(1);
    });

    it('derives a constructor name from the tag in dev mode', async () => {
        const { defineElement } = await importElement(true);

        const Element = defineElement('x-slim-counter', () => null);

        expect(Element.name).toBe('XSlimCounter');
        expect(customElements.define).toHaveBeenCalledWith('x-slim-counter', Element);
    });

    it('uses an anonymous constructor outside dev mode', async () => {
        const { defineElement } = await importElement(false);

        const Element = defineElement('my-counter', () => null);

        expect(Element.name).toBe('');
        expect(customElements.define).toHaveBeenCalledWith('my-counter', Element);
    });

    it('defers disconnected cleanup and permits a later remount', async () => {
        const { defineElement } = await importElement();
        const dispose = vi.fn();
        const disposeAfterRemount = vi.fn();
        render.mockReturnValueOnce(dispose).mockReturnValueOnce(disposeAfterRemount);

        const Element = defineElement('x-slim-dispose', () => null);
        const element = new Element();

        element.isConnected = true;
        element.connectedCallback();

        element.isConnected = false;
        element.disconnectedCallback();

        expect(dispose).not.toHaveBeenCalled();

        await nextMicrotask();

        expect(dispose).toHaveBeenCalledTimes(1);

        element.disconnectedCallback();
        await nextMicrotask();

        expect(dispose).toHaveBeenCalledTimes(1);

        element.isConnected = true;
        element.connectedCallback();

        expect(render).toHaveBeenCalledTimes(2);
        expect(disposeAfterRemount).not.toHaveBeenCalled();
    });

    it('keeps the mounted render when reconnected before cleanup runs', async () => {
        const { defineElement } = await importElement();
        const dispose = vi.fn();
        render.mockReturnValue(dispose);

        const Element = defineElement('x-slim-reconnect', () => null);
        const element = new Element();

        element.isConnected = true;
        element.connectedCallback();

        element.isConnected = false;
        element.disconnectedCallback();
        element.isConnected = true;
        element.connectedCallback();

        await nextMicrotask();

        expect(dispose).not.toHaveBeenCalled();
        expect(render).toHaveBeenCalledTimes(1);
    });
});
