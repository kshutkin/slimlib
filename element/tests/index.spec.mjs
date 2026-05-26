import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.hoisted(() => vi.fn());

vi.mock('@slimlib/jsx', () => ({ render }));

import { defineElement, extend } from '../src/index.js';

const nextMicrotask = () => Promise.resolve();

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
    });

    it('smoke', () => {
        // signature: (tag, render) | (tag, attrs, render)
        expect(typeof defineElement).toBe('function');
        expect(typeof extend).toBe('function');
    });

    it('defers disconnected cleanup and permits a later remount', async () => {
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
