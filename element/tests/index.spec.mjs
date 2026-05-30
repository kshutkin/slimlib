import { afterEach, describe, expect, it, vi } from 'vitest';

import { setScheduler } from '@slimlib/store';

vi.mock('esm-env', () => ({ DEV: true }));

setScheduler(fn => fn());

let counter = 0;
const uniqueTag = base => `${base}-${++counter}`;
const nextMicrotask = () => Promise.resolve();
const supportsCustomizedBuiltIns = () => {
    const tag = uniqueTag('x-slim-built-in-probe');
    try {
        class ProbeButton extends HTMLButtonElement {}
        customElements.define(tag, ProbeButton, { extends: 'button' });
        return document.createElement('button', { is: tag }) instanceof ProbeButton;
    } catch {
        return false;
    }
};

const supportsScopedRegistry = () => {
    try {
        // eslint-disable-next-line no-new
        new CustomElementRegistry();
        return true;
    } catch {
        return false;
    }
};
const scopedRegistryIt = supportsScopedRegistry() ? it : it.skip;

afterEach(() => {
    document.body.innerHTML = '';
});

describe('@slimlib/element public API (DEV)', () => {
    it('exports defineElement, props, and middleware helpers', async () => {
        const api = await import('../src/index.js');
        const { defineElement, props } = api;
        expect(typeof api.createCustomElement).toBe('function');
        expect(typeof defineElement).toBe('function');
        expect(typeof api.defineBuiltinElement).toBe('function');
        expect(typeof props).toBe('function');
        expect(typeof api.attributes).toBe('function');
        expect(typeof api.disabledFeatures).toBe('function');
        expect(typeof api.formAssociated).toBe('function');
        expect(typeof api.withInternals).toBe('function');
        expect(typeof api.onAdopted).toBe('function');
        expect(typeof api.onMove).toBe('function');
    });

    it('attributeChangedCallback writes the named property to the host', async () => {
        const { defineElement, attributes } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-attrs');
        defineElement(tag, [attributes({ value: {} })], () => null);

        const element = document.createElement(tag);
        element.setAttribute('value', 'hello');

        expect(element.value).toBe('hello');
    });
});

describe('middleware-composed defineElement (DEV)', () => {
    it('createCustomElement returns an unregistered class', async () => {
        const { createCustomElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-unregistered');
        const Ctor = createCustomElement(() => null);

        expect(typeof Ctor).toBe('function');
        expect(customElements.get(tag)).toBeUndefined();

        customElements.define(tag, Ctor);
        const element = document.createElement(tag);

        expect(element).toBeInstanceOf(Ctor);
    });

    scopedRegistryIt('registers in a scoped registry without touching the global one', async () => {
        const { createCustomElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-scoped');
        const Ctor = createCustomElement(() => null);

        const registry = new CustomElementRegistry();
        registry.define(tag, Ctor);

        expect(registry.get(tag)).toBe(Ctor);
        expect(customElements.get(tag)).toBeUndefined();

        // Element upgrade through a scoped registry (attachShadow({ customElements }),
        // registry.upgrade(), registry.initialize()) is not yet wired up in the test
        // Chromium — the constructor exists but none of those paths upgrade the node.
        // We therefore assert only the define/get/global-isolation contract here.
    });

    it('observes attributes through attributes({...}) middleware', async () => {
        const { defineElement, attributes } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-observed-middleware');
        defineElement(tag, [attributes({ value: {} })], () => null);

        const element = document.createElement(tag);
        element.setAttribute('value', 'hello');

        expect(element.value).toBe('hello');
    });

    it('rejects a non-array middleware argument in DEV', async () => {
        const { defineElement, attributes } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-bad-middleware');
        expect(() => defineElement(tag, attributes({ x: {} }), () => null)).toThrow(/middleware must be an array/);
    });

    it('disables requested platform features with disabledFeatures([...])', async () => {
        const { defineElement, disabledFeatures } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-disabled-features');
        defineElement(tag, [disabledFeatures(['shadow'])], () => null);

        const element = document.createElement(tag);

        try {
            element.attachShadow({ mode: 'open' });
            throw new Error('attachShadow should throw');
        } catch (error) {
            expect(error).toBeInstanceOf(DOMException);
            expect(error.name).toBe('NotSupportedError');
        }
    });

    it('allocates ElementInternals once with withInternals()', async () => {
        const { defineElement, withInternals } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-internals');
        defineElement(tag, [withInternals()], () => null);

        const element = document.createElement(tag);
        document.body.appendChild(element);

        expect(element._internals).toBeInstanceOf(ElementInternals);
        expect(() => element.attachInternals()).toThrow();
    });

    it('sets the formAssociated static flag', async () => {
        const { defineElement, formAssociated } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-associated');
        defineElement(tag, [formAssociated()], () => null);

        expect(customElements.get(tag).formAssociated).toBe(true);
    });

    it('forwards form reset callbacks to formAssociated({ reset }) handlers', async () => {
        const { defineElement, formAssociated, withInternals } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-reset');
        const reset = vi.fn();
        defineElement(tag, [withInternals(), formAssociated({ reset })], () => null);
        const form = document.createElement('form');
        const element = document.createElement(tag);

        form.appendChild(element);
        document.body.appendChild(form);
        form.reset();

        expect(reset).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledWith(element);
    });

    it('forwards form owner changes to formAssociated({ associated }) handlers', async () => {
        const { defineElement, formAssociated, withInternals } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-owner');
        const associated = vi.fn();
        defineElement(tag, [withInternals(), formAssociated({ associated })], () => null);
        const firstForm = document.createElement('form');
        const secondForm = document.createElement('form');
        const element = document.createElement(tag);

        document.body.append(firstForm, secondForm);
        firstForm.appendChild(element);
        await nextMicrotask();
        secondForm.appendChild(element);
        await nextMicrotask();

        expect(associated).toHaveBeenCalledTimes(3);
        expect(associated).toHaveBeenNthCalledWith(1, element, firstForm);
        expect(associated).toHaveBeenNthCalledWith(2, element, null);
        expect(associated).toHaveBeenNthCalledWith(3, element, secondForm);
    });

    it('forwards fieldset disabled changes to formAssociated({ disabled }) handlers', async () => {
        const { defineElement, formAssociated, withInternals } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-disabled');
        const disabled = vi.fn();
        defineElement(tag, [withInternals(), formAssociated({ disabled })], () => null);
        const form = document.createElement('form');
        const fieldset = document.createElement('fieldset');
        const element = document.createElement(tag);

        fieldset.appendChild(element);
        form.appendChild(fieldset);
        document.body.appendChild(form);
        fieldset.disabled = true;
        await nextMicrotask();
        fieldset.disabled = false;
        await nextMicrotask();

        expect(disabled).toHaveBeenNthCalledWith(1, element, true);
        expect(disabled).toHaveBeenNthCalledWith(2, element, false);
    });

    it('forwards state restore callbacks to formAssociated({ stateRestore }) handlers', async () => {
        const { defineElement, formAssociated, withInternals } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-state-restore');
        const stateRestore = vi.fn();
        defineElement(tag, [withInternals(), formAssociated({ stateRestore })], () => null);
        const element = document.createElement(tag);
        const Ctor = customElements.get(tag);

        // Browser restoration needs bfcache/autofill, so invoke the platform callback directly.
        Ctor.prototype.formStateRestoreCallback.call(element, 'state-value', 'restore');

        expect(stateRestore).toHaveBeenCalledTimes(1);
        expect(stateRestore).toHaveBeenCalledWith(element, 'state-value', 'restore');
    });

    it('does not install absent formAssociated callbacks', async () => {
        const { defineElement, formAssociated } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-absent');
        defineElement(tag, [formAssociated({ reset: vi.fn() })], () => null);
        const Ctor = customElements.get(tag);

        expect('formResetCallback' in Ctor.prototype).toBe(true);
        expect('formDisabledCallback' in Ctor.prototype).toBe(false);
    });

    it('installs adoptedCallback through onAdopted(fn)', async () => {
        const { defineElement, onAdopted } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-adopted');
        defineElement(tag, [onAdopted(() => {})], () => null);
        const Ctor = customElements.get(tag);

        expect('adoptedCallback' in Ctor.prototype).toBe(true);
    });

    it('forwards adopted callbacks to onAdopted(fn)', async () => {
        const { defineElement, onAdopted } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-adopted-body');
        const adopted = vi.fn();
        defineElement(tag, [onAdopted(adopted)], () => null);
        const element = document.createElement(tag);
        const oldDoc = element.ownerDocument;
        const newDoc = document.implementation.createHTMLDocument('new-owner');

        newDoc.adoptNode(element);

        expect(adopted).toHaveBeenCalledTimes(1);
        expect(adopted).toHaveBeenCalledWith(element, oldDoc, newDoc);
    });

    it('installs connectedMoveCallback through onMove(fn)', async () => {
        const { defineElement, onMove } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-move');
        defineElement(tag, [onMove(() => {})], () => null);
        const Ctor = customElements.get(tag);

        expect('connectedMoveCallback' in Ctor.prototype).toBe(true);
    });

    it('forwards connectedMoveCallback to onMove(fn)', async () => {
        const { defineElement, onMove } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-move-body');
        const moved = vi.fn();
        defineElement(tag, [onMove(moved)], () => null);
        const parent = document.createElement('div');
        const element = document.createElement(tag);
        const anotherChild = document.createElement('span');

        parent.append(element, anotherChild);
        document.body.appendChild(parent);
        if (typeof parent.moveBefore === 'function') {
            parent.moveBefore(element, anotherChild);
        } else {
            const Ctor = customElements.get(tag);
            // Element.moveBefore is not available in every test browser, so invoke the hook directly.
            Ctor.prototype.connectedMoveCallback.call(element);
        }

        expect(moved).toHaveBeenCalledTimes(1);
        expect(moved).toHaveBeenCalledWith(element);
    });

    it('applies middleware from inside out while preserving outer-to-inner prototype order', async () => {
        const { defineElement } = await import('../src/index.js');
        const applied = [];
        const layerNames = [];
        const createLayer = name => Base => {
            applied.push(name);
            class Layer extends Base {}
            Object.defineProperty(Layer, name, { value: true });
            Object.defineProperty(Layer.prototype, 'layerName', { value: name });
            return Layer;
        };
        const tag = uniqueTag('x-slim-order');
        defineElement(tag, [createLayer('A'), createLayer('B'), createLayer('C')], () => null);
        let prototype = customElements.get(tag).prototype;

        while (prototype && prototype !== HTMLElement.prototype) {
            if (Object.hasOwn(prototype, 'layerName')) layerNames.push(prototype.layerName);
            prototype = Object.getPrototypeOf(prototype);
        }

        expect(applied).toEqual(['C', 'B', 'A']);
        expect(layerNames).toEqual(['A', 'B', 'C']);
    });

    const customizedBuiltInIt = supportsCustomizedBuiltIns() ? it : it.skip;
    // Skip outside browsers that implement customized built-ins and createElement(type, { is }).
    customizedBuiltInIt('supports customized built-ins through extendElement', async () => {
        const { defineBuiltinElement, attributes } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-button');
        let renderCount = 0;
        defineBuiltinElement(tag, 'button', [attributes({ 'data-x': {} })], () => {
            renderCount++;
            return null;
        });
        const Element = customElements.get(tag);

        const element = document.createElement('button', { is: tag });
        element.setAttribute('data-x', 'hello');
        document.body.appendChild(element);

        expect(customElements.get(tag)).toBe(Element);
        expect(element).toBeInstanceOf(HTMLButtonElement);
        expect(element).toBeInstanceOf(Element);
        expect(element['data-x']).toBe('hello');
        expect(renderCount).toBe(1);
    });

    customizedBuiltInIt('upgrades a defineBuiltinElement element through the jsx is= runtime', async () => {
        const { defineBuiltinElement, attributes } = await import('../src/index.js');
        const { createElement: jsxCreateElement } = await import('@slimlib/jsx');
        const tag = uniqueTag('x-slim-jsx-button');
        let renderCount = 0;
        defineBuiltinElement(tag, 'button', [attributes({ 'data-label': {} })], () => {
            renderCount++;
            return jsxCreateElement('span', null, 'inner');
        });
        const Ctor = customElements.get(tag);

        const element = jsxCreateElement('button', { is: tag });

        expect(element).toBeInstanceOf(Ctor);
        expect(element).toBeInstanceOf(HTMLButtonElement);
        expect(element.getAttribute('is')).toBe(tag);

        document.body.appendChild(element);

        expect(renderCount).toBe(1);
        expect(element.querySelector('span')?.textContent).toBe('inner');

        element.setAttribute('data-label', 'x');
        expect(element['data-label']).toBe('x');
    });

    it('keeps slim core innermost so middleware can override connectedCallback', async () => {
        const { defineElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-connected-override');
        let renderCount = 0;
        let connectedCount = 0;
        const markConnected = Base =>
            class extends Base {
                connectedCallback() {
                    super.connectedCallback();
                    connectedCount++;
                }
            };
        defineElement(tag, [markConnected], () => {
            renderCount++;
            return null;
        });

        document.body.appendChild(document.createElement(tag));

        expect(connectedCount).toBe(1);
        expect(renderCount).toBe(1);
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
        const { defineElement, attributes, props } = await import('../src/index.js');

        let reactiveState;
        const tag = uniqueTag('x-props-adopt');
        defineElement(tag, [attributes({ value: {} })], () => {
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
        defineElement(tag, () => null);
        const Element = customElements.get(tag);

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

describe('attributes() reflection + coercion (DEV)', () => {
    it('coerces a Number attribute in', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-num-in');
        defineElement(tag, [attributes({ count: { type: Number } })], () => {
            props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        element.setAttribute('count', '5');
        document.body.appendChild(element);

        expect(typeof element.count).toBe('number');
        expect(element.count).toBe(5);
    });

    it('coerces a Boolean attribute in by presence/absence', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-bool-in');
        defineElement(tag, [attributes({ open: { type: Boolean } })], () => {
            props({ open: false });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('open', '');
        expect(element.open).toBe(true);

        element.removeAttribute('open');
        expect(element.open).toBe(false);
    });

    it('reflects a Number prop out to the attribute', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-num-out');
        defineElement(tag, [attributes({ count: { type: Number, reflect: true } })], () => {
            props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.count = 7;
        expect(element.getAttribute('count')).toBe('7');

        element.count = null;
        expect(element.hasAttribute('count')).toBe(false);
    });

    it('reflects a Boolean prop out by adding/removing the attribute', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-bool-out');
        defineElement(tag, [attributes({ open: { type: Boolean, reflect: true } })], () => {
            props({ open: false });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.open = true;
        expect(element.hasAttribute('open')).toBe(true);

        element.open = false;
        expect(element.hasAttribute('open')).toBe(false);
    });

    it('reflects when the reactive proxy is mutated directly', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        let reactiveState;
        const tag = uniqueTag('x-attr-proxy');
        defineElement(tag, [attributes({ count: { type: Number, reflect: true } })], () => {
            reactiveState = props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        reactiveState.count++;
        expect(element.getAttribute('count')).toBe('1');
    });

    it('settles a reflected round-trip without looping', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-roundtrip');
        defineElement(tag, [attributes({ count: { type: Number, reflect: true } })], () => {
            props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('count', '05');

        expect(element.count).toBe(5);
        expect(element.getAttribute('count')).toBe('5');
    });

    it('warns when a reflected attribute is not declared via props()', async () => {
        const { defineElement, attributes } = await import('../src/index.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tag = uniqueTag('x-attr-undeclared');
        defineElement(tag, [attributes({ ghost: { reflect: true } })], () => null);

        document.body.appendChild(document.createElement(tag));

        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('keeps reflecting after the element is moved to a new parent', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-move');
        defineElement(tag, [attributes({ count: { type: Number, reflect: true } })], () => {
            props({ count: 0 });
            return null;
        });

        const first = document.createElement('div');
        const second = document.createElement('div');
        document.body.append(first, second);

        const element = document.createElement(tag);
        first.appendChild(element);

        second.appendChild(element);

        element.count = 3;
        expect(element.getAttribute('count')).toBe('3');
    });

    it('recreates the reflect effect on remount and tracks the new state proxy', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        let reactiveState;
        const tag = uniqueTag('x-attr-remount');
        defineElement(tag, [attributes({ count: { type: Number, reflect: true } })], () => {
            reactiveState = props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        // Disconnect; the core teardown is deferred a microtask before #mounted resets.
        element.remove();
        await nextMicrotask();
        await nextMicrotask();

        document.body.appendChild(element);

        // reactiveState now references the proxy created by the second render.
        reactiveState.count = 9;
        expect(element.getAttribute('count')).toBe('9');
    });

    it('observes a non-reflected descriptor without auto-reflecting JS writes', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-observe-only');
        defineElement(tag, [attributes({ label: {} })], () => {
            props({ label: '' });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('label', 'hi');
        expect(element.label).toBe('hi');

        element.label = 'x';
        expect(element.getAttribute('label')).toBe('hi');
    });

    it('coerces an inbound attribute with a custom type function', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-custom-in');
        defineElement(tag, [attributes({ csv: { type: raw => (raw ? raw.split(',') : []) } })], () => {
            props({ csv: [] });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('csv', 'a,b');
        expect(element.csv).toEqual(['a', 'b']);
    });
});
