import { afterEach, describe, expect, it, vi } from 'vitest';

import { setScheduler } from '@slimlib/store';

vi.mock('esm-env', () => ({ DEV: true }));

setScheduler(fn => fn());

let counter = 0;
const uniqueTag = base => `${base}-${++counter}`;
const nextMicrotask = () => Promise.resolve();

afterEach(() => {
    document.body.innerHTML = '';
});

describe('@slimlib/element public API (DEV)', () => {
    it('exports defineElement and props', async () => {
        const { defineElement, props } = await import('../src/index.js');
        expect(typeof defineElement).toBe('function');
        expect(typeof props).toBe('function');
    });

    it('attributeChangedCallback writes the named property to the host', async () => {
        const { defineElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-attrs');
        defineElement(tag, ['value'], () => null);

        const element = document.createElement(tag);
        element.setAttribute('value', 'hello');

        expect(element.value).toBe('hello');
    });
});

describe('props() (DEV)', () => {
    it('throws when called outside a defineElement render callback', async () => {
        const { props } = await import('../src/index.js');
        expect(() => props({ count: 0 })).toThrow(/must be called synchronously inside a defineElement render callback/);
    });

    it('installs reactive accessors that read/write through the state proxy', async () => {
        const { defineElement, props } = await import('../src/index.js');

        let reactiveState;
        const tag = uniqueTag('x-props-rw');
        defineElement(tag, () => {
            reactiveState = props({ count: 42 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        expect(element.count).toBe(42);
        expect(reactiveState.count).toBe(42);

        element.count = 99;
        expect(element.count).toBe(99);
        expect(reactiveState.count).toBe(99);

        reactiveState.count = 7;
        expect(element.count).toBe(7);
    });

    it('adopts own properties already present on the host before connect', async () => {
        const { defineElement, props } = await import('../src/index.js');

        let reactiveState;
        const tag = uniqueTag('x-props-adopt');
        defineElement(tag, ['value'], () => {
            reactiveState = props({ value: 'default' });
            return null;
        });

        const element = document.createElement(tag);
        // attributeChangedCallback fires on observed-attribute write even while disconnected,
        // installing an own property `value` on the host before props() runs.
        element.setAttribute('value', 'hello');
        expect(element.value).toBe('hello');

        document.body.appendChild(element);

        expect(element.value).toBe('hello');
        expect(reactiveState.value).toBe('hello');
    });
});

describe('defineElement constructor naming (DEV)', () => {
    it('derives a PascalCase constructor name from the tag', async () => {
        const { defineElement } = await import('../src/index.js');

        const tag = uniqueTag('x-slim-counter-dev');
        const Element = defineElement(tag, () => null);

        const expected = tag.replace(/(^|-)(\w)/g, (_, _d, c) => c.toUpperCase());
        expect(Element.name).toBe(expected);
        expect(customElements.get(tag)).toBe(Element);
    });
});

describe('connected/disconnected lifecycle (DEV)', () => {
    it('defers disconnected cleanup and permits a later remount', async () => {
        const { defineElement } = await import('../src/index.js');

        let renderCount = 0;
        const tag = uniqueTag('x-slim-dispose');
        defineElement(tag, () => {
            renderCount++;
            return null;
        });

        const element = document.createElement(tag);

        document.body.appendChild(element);
        expect(renderCount).toBe(1);

        document.body.removeChild(element);
        await nextMicrotask();
        await nextMicrotask();

        document.body.appendChild(element);
        expect(renderCount).toBe(2);
    });

    it('keeps the mounted render when reconnected before cleanup runs', async () => {
        const { defineElement } = await import('../src/index.js');

        let renderCount = 0;
        const tag = uniqueTag('x-slim-reconnect');
        defineElement(tag, () => {
            renderCount++;
            return null;
        });

        const element = document.createElement(tag);

        document.body.appendChild(element);
        expect(renderCount).toBe(1);

        document.body.removeChild(element);
        document.body.appendChild(element);
        await nextMicrotask();
        await nextMicrotask();

        expect(renderCount).toBe(1);
    });

    it('runs jsx dispose (ref(null)) after deferred disconnect', async () => {
        const { defineElement } = await import('../src/index.js');
        const { createElement } = await import('@slimlib/jsx');

        const refCalls = [];
        const tag = uniqueTag('x-slim-ref-dispose');
        defineElement(tag, () =>
            createElement('span', {
                ref: node => {
                    refCalls.push(node);
                },
            })
        );

        const element = document.createElement(tag);
        document.body.appendChild(element);

        // ref fired once with the span on mount.
        expect(refCalls).toHaveLength(1);
        expect(refCalls[0]?.nodeName).toBe('SPAN');

        document.body.removeChild(element);
        // Not yet — cleanup is deferred.
        expect(refCalls).toHaveLength(1);
        await nextMicrotask();
        await nextMicrotask();

        // After microtask: ref(null) fired during jsx scope teardown.
        expect(refCalls).toHaveLength(2);
        expect(refCalls[1]).toBeNull();
    });

    it('does NOT run jsx dispose when reconnected before cleanup', async () => {
        const { defineElement } = await import('../src/index.js');
        const { createElement } = await import('@slimlib/jsx');

        const refCalls = [];
        const tag = uniqueTag('x-slim-ref-reconnect');
        defineElement(tag, () =>
            createElement('span', {
                ref: node => {
                    refCalls.push(node);
                },
            })
        );

        const element = document.createElement(tag);
        document.body.appendChild(element);
        expect(refCalls).toHaveLength(1);

        document.body.removeChild(element);
        document.body.appendChild(element);
        await nextMicrotask();
        await nextMicrotask();

        // No teardown happened, so no second (null) ref call.
        expect(refCalls).toHaveLength(1);
        expect(refCalls[0]?.nodeName).toBe('SPAN');
    });
});
