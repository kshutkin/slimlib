import { afterEach, describe, expect, it, vi } from 'vitest';

import { setScheduler } from '@slimlib/store';

vi.mock('esm-env', () => ({ DEV: true }));

setScheduler(scheduledCallback => scheduledCallback());

let counter = 0;
const uniqueTag = baseName => `${baseName}-${++counter}`;
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
        const elementModule = await import('../src/index.js');
        const { defineElement, props } = elementModule;
        expect(typeof elementModule.createCustomElement).toBe('function');
        expect(typeof defineElement).toBe('function');
        expect(typeof elementModule.defineBuiltinElement).toBe('function');
        expect(typeof props).toBe('function');
        expect(typeof elementModule.attributes).toBe('function');
        expect(typeof elementModule.disabledFeatures).toBe('function');
        expect(typeof elementModule.formAssociated).toBe('function');
        expect(typeof elementModule.withInternals).toBe('function');
        expect(typeof elementModule.onAdopted).toBe('function');
        expect(typeof elementModule.onMove).toBe('function');
    });

    it('attributeChangedCallback writes the named property to the host', async () => {
        const { defineElement, attributes, stringAttr } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-attrs');
        defineElement(tag, [attributes({ value: [stringAttr[0]] })], () => null);

        const element = document.createElement(tag);
        element.setAttribute('value', 'hello');

        expect(element.value).toBe('hello');
    });
});

describe('middleware-composed defineElement (DEV)', () => {
    it('createCustomElement returns an unregistered class', async () => {
        const { createCustomElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-unregistered');
        const ElementConstructor = createCustomElement(() => null);

        expect(typeof ElementConstructor).toBe('function');
        expect(customElements.get(tag)).toBeUndefined();

        customElements.define(tag, ElementConstructor);
        const element = document.createElement(tag);

        expect(element).toBeInstanceOf(ElementConstructor);
    });

    scopedRegistryIt('registers in a scoped registry without touching the global one', async () => {
        const { createCustomElement } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-scoped');
        const ElementConstructor = createCustomElement(() => null);

        const registry = new CustomElementRegistry();
        registry.define(tag, ElementConstructor);

        expect(registry.get(tag)).toBe(ElementConstructor);
        expect(customElements.get(tag)).toBeUndefined();

        // Element upgrade through a scoped registry (attachShadow({ customElements }),
        // registry.upgrade(), registry.initialize()) is not yet wired up in the test
        // Chromium — the constructor exists but none of those paths upgrade the node.
        // We therefore assert only the define/get/global-isolation contract here.
    });

    it('observes attributes through attributes({...}) middleware', async () => {
        const { defineElement, attributes, stringAttr } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-observed-middleware');
        defineElement(tag, [attributes({ value: [stringAttr[0]] })], () => null);

        const element = document.createElement(tag);
        element.setAttribute('value', 'hello');

        expect(element.value).toBe('hello');
    });

    it('rejects a non-array middleware argument in DEV', async () => {
        const { defineElement, attributes } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-bad-middleware');
        expect(() => defineElement(tag, attributes({ x: [] }), () => null)).toThrow(/middleware must be an array/);
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

    it('emits form reset lifecycle events from formAssociated()', async () => {
        const { defineElement, formAssociated, withInternals, onFormReset } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-reset');
        const reset = vi.fn();
        defineElement(tag, [withInternals(), formAssociated()], () => {
            onFormReset(reset);
            return null;
        });
        const form = document.createElement('form');
        const element = document.createElement(tag);

        form.appendChild(element);
        document.body.appendChild(form);
        form.reset();

        expect(reset).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledWith();
    });

    it('emits form owner lifecycle events from formAssociated()', async () => {
        const { defineElement, formAssociated, withInternals, onFormAssociated } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-owner');
        const associated = vi.fn();
        defineElement(tag, [withInternals(), formAssociated()], () => {
            onFormAssociated(associated);
            return null;
        });
        const firstForm = document.createElement('form');
        const secondForm = document.createElement('form');
        const element = document.createElement(tag);

        document.body.append(firstForm, secondForm);
        document.body.appendChild(element);
        await nextMicrotask();
        firstForm.appendChild(element);
        await nextMicrotask();
        secondForm.appendChild(element);
        await nextMicrotask();

        expect(associated).toHaveBeenCalledTimes(3);
        expect(associated).toHaveBeenNthCalledWith(1, firstForm);
        expect(associated).toHaveBeenNthCalledWith(2, null);
        expect(associated).toHaveBeenNthCalledWith(3, secondForm);
    });

    it('emits fieldset disabled lifecycle events from formAssociated()', async () => {
        const { defineElement, formAssociated, withInternals, onFormDisabled } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-disabled');
        const disabled = vi.fn();
        defineElement(tag, [withInternals(), formAssociated()], () => {
            onFormDisabled(disabled);
            return null;
        });
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

        expect(disabled).toHaveBeenNthCalledWith(1, true);
        expect(disabled).toHaveBeenNthCalledWith(2, false);
    });

    it('emits state restore lifecycle events from formAssociated()', async () => {
        const { defineElement, formAssociated, withInternals, onFormStateRestore } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-state-restore');
        const stateRestore = vi.fn();
        defineElement(tag, [withInternals(), formAssociated()], () => {
            onFormStateRestore(stateRestore);
            return null;
        });
        const element = document.createElement(tag);
        const ElementConstructor = customElements.get(tag);
        document.body.appendChild(element);

        // Browser restoration needs bfcache/autofill, so invoke the platform callback directly.
        ElementConstructor.prototype.formStateRestoreCallback.call(element, 'state-value', 'restore');

        expect(stateRestore).toHaveBeenCalledTimes(1);
        expect(stateRestore).toHaveBeenCalledWith('state-value', 'restore');
    });

    it('installs all form-associated callbacks for lifecycle events', async () => {
        const { defineElement, formAssociated } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-form-absent');
        defineElement(tag, [formAssociated()], () => null);
        const ElementConstructor = customElements.get(tag);

        expect('formAssociatedCallback' in ElementConstructor.prototype).toBe(true);
        expect('formResetCallback' in ElementConstructor.prototype).toBe(true);
        expect('formDisabledCallback' in ElementConstructor.prototype).toBe(true);
        expect('formStateRestoreCallback' in ElementConstructor.prototype).toBe(true);
    });

    it('installs adoptedCallback through onAdopted()', async () => {
        const { defineElement, onAdopted } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-adopted');
        defineElement(tag, [onAdopted()], () => null);
        const ElementConstructor = customElements.get(tag);

        expect('adoptedCallback' in ElementConstructor.prototype).toBe(true);
    });

    it('emits adopted lifecycle events from onAdopted()', async () => {
        const { defineElement, onAdopted, onAdoptedCallback } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-adopted-body');
        const adopted = vi.fn();
        defineElement(tag, [onAdopted()], () => {
            onAdoptedCallback(adopted);
            return null;
        });
        const element = document.createElement(tag);
        document.body.appendChild(element);
        const oldDocument = element.ownerDocument;
        const newDocument = document.implementation.createHTMLDocument('new-owner');

        newDocument.adoptNode(element);

        expect(adopted).toHaveBeenCalledTimes(1);
        expect(adopted).toHaveBeenCalledWith(oldDocument, newDocument);
    });

    it('installs connectedMoveCallback through onMove()', async () => {
        const { defineElement, onMove } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-move');
        defineElement(tag, [onMove()], () => null);
        const ElementConstructor = customElements.get(tag);

        expect('connectedMoveCallback' in ElementConstructor.prototype).toBe(true);
    });

    it('emits connectedMoveCallback lifecycle events from onMove()', async () => {
        const { defineElement, onMove, onConnectedMove } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-move-body');
        const moved = vi.fn();
        defineElement(tag, [onMove()], () => {
            onConnectedMove(moved);
            return null;
        });
        const parent = document.createElement('div');
        const element = document.createElement(tag);
        const anotherChild = document.createElement('span');

        parent.append(element, anotherChild);
        document.body.appendChild(parent);
        if (typeof parent.moveBefore === 'function') {
            parent.moveBefore(element, anotherChild);
        } else {
            const ElementConstructor = customElements.get(tag);
            // Element.moveBefore is not available in every test browser, so invoke the hook directly.
            ElementConstructor.prototype.connectedMoveCallback.call(element);
        }

        expect(moved).toHaveBeenCalledTimes(1);
        expect(moved).toHaveBeenCalledWith();
    });

    it('applies middleware from inside out while preserving outer-to-inner prototype order', async () => {
        const { defineElement } = await import('../src/index.js');
        const appliedLayerNames = [];
        const layerNames = [];
        const createLayer = layerName => ElementBase => {
            appliedLayerNames.push(layerName);
            class Layer extends ElementBase {}
            Object.defineProperty(Layer, layerName, { value: true });
            Object.defineProperty(Layer.prototype, 'layerName', { value: layerName });
            return Layer;
        };
        const tag = uniqueTag('x-slim-order');
        defineElement(tag, [createLayer('A'), createLayer('B'), createLayer('C')], () => null);
        let prototype = customElements.get(tag).prototype;

        while (prototype && prototype !== HTMLElement.prototype) {
            if (Object.hasOwn(prototype, 'layerName')) {
                layerNames.push(prototype.layerName);
            }
            prototype = Object.getPrototypeOf(prototype);
        }

        expect(appliedLayerNames).toEqual(['C', 'B', 'A']);
        expect(layerNames).toEqual(['A', 'B', 'C']);
    });

    const customizedBuiltInIt = supportsCustomizedBuiltIns() ? it : it.skip;
    // Skip outside browsers that implement customized built-ins and createElement(type, { is }).
    customizedBuiltInIt('supports customized built-ins through extendElement', async () => {
        const { defineBuiltinElement, attributes, stringAttr } = await import('../src/index.js');
        const tag = uniqueTag('x-slim-button');
        let renderCount = 0;
        defineBuiltinElement(tag, 'button', [attributes({ 'data-x': [stringAttr[0]] })], () => {
            renderCount++;
            return null;
        });
        const ElementConstructor = customElements.get(tag);

        const element = document.createElement('button', { is: tag });
        element.setAttribute('data-x', 'hello');
        document.body.appendChild(element);

        expect(customElements.get(tag)).toBe(ElementConstructor);
        expect(element).toBeInstanceOf(HTMLButtonElement);
        expect(element).toBeInstanceOf(ElementConstructor);
        expect(element['data-x']).toBe('hello');
        expect(renderCount).toBe(1);
    });

    customizedBuiltInIt('upgrades a defineBuiltinElement element through the jsx is= runtime', async () => {
        const { defineBuiltinElement, attributes, stringAttr } = await import('../src/index.js');
        const { createElement: jsxCreateElement } = await import('@slimlib/jsx');
        const tag = uniqueTag('x-slim-jsx-button');
        let renderCount = 0;
        defineBuiltinElement(tag, 'button', [attributes({ 'data-label': [stringAttr[0]] })], () => {
            renderCount++;
            return jsxCreateElement('span', null, 'inner');
        });
        const ElementConstructor = customElements.get(tag);

        const element = jsxCreateElement('button', { is: tag });

        expect(element).toBeInstanceOf(ElementConstructor);
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
        const markConnected = ElementBase =>
            class extends ElementBase {
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

describe('lifecycle message bus (DEV)', () => {
    it('exports lifecycle hooks but keeps lifecycle symbols internal', async () => {
        const elementModule = await import('../src/index.js');
        for (const name of [
            'onMount',
            'onConnect',
            'onDisconnect',
            'onAdoptedCallback',
            'onConnectedMove',
            'onFormAssociated',
            'onFormDisabled',
            'onFormReset',
            'onFormStateRestore',
        ]) {
            expect(typeof elementModule[name]).toBe('function');
        }
        expect('onUnmount' in elementModule).toBe(false);
        expect('subscribe' in elementModule).toBe(false);
        for (const name of [
            'MOUNT',
            'UNMOUNT',
            'CONNECT',
            'DISCONNECT',
            'ADOPTED',
            'MOVE',
            'FORM_ASSOCIATED',
            'FORM_DISABLED',
            'FORM_RESET',
            'FORM_STATE_RESTORE',
        ]) {
            expect(name in elementModule).toBe(false);
        }
    });

    it('throws when a hook is called outside a render callback', async () => {
        const { onConnect } = await import('../src/index.js');
        expect(() => onConnect(() => {})).toThrow(/must be called synchronously inside a defineElement render callback/);
    });

    it('fires mount once and connect on every connect (including sync moves)', async () => {
        const { defineElement, onMount, onConnect } = await import('../src/index.js');
        const mount = vi.fn();
        const connect = vi.fn();
        const tag = uniqueTag('x-bus-mount-connect');
        defineElement(tag, () => {
            onMount(mount);
            onConnect(connect);
            return null;
        });

        const element = document.createElement(tag);
        const containerA = document.createElement('div');
        const containerB = document.createElement('div');
        document.body.append(containerA, containerB);
        containerA.appendChild(element);

        expect(mount).toHaveBeenCalledTimes(1);
        expect(connect).toHaveBeenCalledTimes(1);

        // Synchronous move across connected parents: connect fires again, mount does not.
        containerB.appendChild(element);
        await nextMicrotask();

        expect(mount).toHaveBeenCalledTimes(1);
        expect(connect).toHaveBeenCalledTimes(2);
    });

    it('does not run mount cleanup on a synchronous move', async () => {
        const { defineElement, onMount } = await import('../src/index.js');
        const cleanup = vi.fn();
        const tag = uniqueTag('x-bus-move-no-cleanup');
        defineElement(tag, () => {
            onMount(() => cleanup);
            return null;
        });

        const element = document.createElement(tag);
        const containerA = document.createElement('div');
        const containerB = document.createElement('div');
        document.body.append(containerA, containerB);
        containerA.appendChild(element);
        containerB.appendChild(element);
        await nextMicrotask();

        expect(cleanup).not.toHaveBeenCalled();
    });

    it('fires disconnect and mount cleanup on each genuine disconnect', async () => {
        const { defineElement, onDisconnect, onMount } = await import('../src/index.js');
        const disconnect = vi.fn();
        const cleanup = vi.fn();
        const tag = uniqueTag('x-bus-mount-cleanup');
        defineElement(tag, () => {
            onDisconnect(disconnect);
            onMount(() => cleanup);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        element.remove();
        await nextMicrotask();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(cleanup).toHaveBeenCalledTimes(1);

        document.body.appendChild(element);
        await nextMicrotask();
        element.remove();
        await nextMicrotask();

        expect(disconnect).toHaveBeenCalledTimes(2);
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('refreshes a reused mount cleanup slot across cycles instead of stacking it', async () => {
        const { defineElement, onMount } = await import('../src/index.js');
        const { UNMOUNT } = await import('../src/symbols.js');
        // A stable cleanup identity is returned on every mount. Its UNMOUNT slot is
        // reused (tag refreshed) rather than duplicated across genuine cycles.
        const cleanup = vi.fn();
        const tag = uniqueTag('x-bus-stale-mount-cleanup');
        defineElement(tag, () => {
            onMount(() => cleanup);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        element.remove();
        await nextMicrotask();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(element[UNMOUNT].length).toBe(1);

        document.body.appendChild(element);
        await nextMicrotask();
        element.remove();
        await nextMicrotask();

        // Fires once per genuine disconnect, and the slot was reused (not stacked).
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(element[UNMOUNT].length).toBe(1);
    });

    it('clears render listeners on unmount so a remount does not stack duplicates', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const connect = vi.fn();
        const tag = uniqueTag('x-bus-remount');
        defineElement(tag, () => {
            onConnect(connect);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        expect(connect).toHaveBeenCalledTimes(1);

        // Genuine disconnect: the render generation advances, marking render-time listeners stale.
        element.remove();
        await nextMicrotask();

        // Remount: render re-runs and re-registers a single fresh listener.
        document.body.appendChild(element);
        await nextMicrotask();

        expect(connect).toHaveBeenCalledTimes(2);
    });

    it('keeps middleware-style on() subscriptions across remounts while clearing render-time ones', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const { CONNECT } = await import('../src/symbols.js');
        const persistent = vi.fn();
        const renderScoped = vi.fn();
        const tag = uniqueTag('x-bus-persist');
        defineElement(tag, () => {
            onConnect(renderScoped);
            return null;
        });

        const element = document.createElement(tag);
        // Middleware-style subscription: registered once, directly on the host.
        element[CONNECT].push(persistent);
        document.body.appendChild(element);
        expect(persistent).toHaveBeenCalledTimes(1);
        expect(renderScoped).toHaveBeenCalledTimes(1);

        element.remove();
        await nextMicrotask();
        document.body.appendChild(element);
        await nextMicrotask();

        // Persistent survived both connects; render-scoped was cleared and re-registered (no stacking).
        expect(persistent).toHaveBeenCalledTimes(2);
        expect(renderScoped).toHaveBeenCalledTimes(2);
    });

    it('compacts stale render-time listeners across remounts instead of accumulating them', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const { CONNECT } = await import('../src/symbols.js');
        const tag = uniqueTag('x-bus-compact');
        defineElement(tag, () => {
            onConnect(vi.fn());
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        // Several genuine unmount + remount cycles; each render re-registers one listener.
        for (let cycle = 0; cycle < 3; ++cycle) {
            element.remove();
            await nextMicrotask();
            document.body.appendChild(element);
            await nextMicrotask();
        }

        // Stale listeners from prior generations are compacted away, not stacked.
        expect(element[CONNECT].length).toBe(1);
    });

    it('does not double-invoke a render-time listener reused across renders', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const stableConnect = vi.fn();
        const tag = uniqueTag('x-bus-stable-reuse');
        defineElement(tag, () => {
            onConnect(stableConnect);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        expect(stableConnect).toHaveBeenCalledTimes(1);

        // Genuine unmount + remount: the same function identity re-subscribes.
        element.remove();
        await nextMicrotask();
        document.body.appendChild(element);
        await nextMicrotask();

        // Exactly one call per connect — the aliasing fix prevents a stale copy firing too.
        expect(stableConnect).toHaveBeenCalledTimes(2);
    });

    it('keeps one shared listener identity independent across different hooks', async () => {
        const { defineElement, onConnect, onDisconnect } = await import('../src/index.js');
        const { CONNECT, DISCONNECT } = await import('../src/symbols.js');
        // The same function backs two different hooks. Tags are keyed per list, so
        // it lands in both lists and stays in both across a genuine remount.
        const shared = vi.fn();
        const tag = uniqueTag('x-bus-shared-hooks');
        defineElement(tag, () => {
            onConnect(shared);
            onDisconnect(shared);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element); // connect → shared (1)
        expect(shared).toHaveBeenCalledTimes(1);

        element.remove(); // disconnect → shared (2)
        await nextMicrotask(); // genuine unmount
        document.body.appendChild(element); // remount re-renders → connect → shared (3)
        await nextMicrotask();

        expect(shared).toHaveBeenCalledTimes(3);
        // Each list reused its single slot rather than dropping or stacking it.
        expect(element[CONNECT].length).toBe(1);
        expect(element[DISCONNECT].length).toBe(1);
    });

    it('warns in DEV when a listener identity is shared across instances', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // One module-level function reused by every instance of the element.
        const shared = () => {};
        const tag = uniqueTag('x-bus-cross-instance');
        defineElement(tag, () => {
            onConnect(shared);
            return null;
        });

        document.body.appendChild(document.createElement(tag)); // first owner — no warning
        expect(warn).not.toHaveBeenCalled();

        document.body.appendChild(document.createElement(tag)); // second instance — warns
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('more than one element instance'));
        warn.mockRestore();
    });

    it('warns in DEV when an onMount cleanup identity is shared across instances', async () => {
        const { defineElement, onMount } = await import('../src/index.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // A stable cleanup identity returned by every instance's mount.
        const cleanup = () => {};
        const tag = uniqueTag('x-bus-cross-instance-cleanup');
        defineElement(tag, () => {
            onMount(() => cleanup);
            return null;
        });

        document.body.appendChild(document.createElement(tag)); // first owner — no warning
        expect(warn).not.toHaveBeenCalled();

        document.body.appendChild(document.createElement(tag)); // second instance — warns
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('more than one element instance'));
        warn.mockRestore();
    });

    it('returns undefined from render-time lifecycle hooks', async () => {
        const { defineElement, onMount, onConnect } = await import('../src/index.js');
        const subscriptionResults = [];
        const tag = uniqueTag('x-bus-hook-return');
        defineElement(tag, () => {
            subscriptionResults.push(onMount(() => () => {}));
            subscriptionResults.push(onConnect(() => {}));
            return null;
        });

        document.body.appendChild(document.createElement(tag));

        expect(subscriptionResults).toEqual([undefined, undefined]);
    });

    it('routes onAdopted middleware events to render-time subscribers via the bus', async () => {
        const { defineElement, onAdopted, onAdoptedCallback } = await import('../src/index.js');
        const busListener = vi.fn();
        const tag = uniqueTag('x-bus-adopted');
        defineElement(tag, [onAdopted()], () => {
            onAdoptedCallback(busListener);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        const oldDocument = element.ownerDocument;
        const newDocument = document.implementation.createHTMLDocument('new-owner');
        newDocument.adoptNode(element);

        expect(busListener).toHaveBeenCalledWith(oldDocument, newDocument);
    });

    it('routes formAssociated middleware events to render-time subscribers via the bus', async () => {
        const { defineElement, formAssociated, withInternals, onFormStateRestore } = await import('../src/index.js');
        const busListener = vi.fn();
        const tag = uniqueTag('x-bus-form-state');
        defineElement(tag, [withInternals(), formAssociated()], () => {
            onFormStateRestore(busListener);
            return null;
        });
        const element = document.createElement(tag);
        document.body.appendChild(element);
        const ElementConstructor = customElements.get(tag);

        ElementConstructor.prototype.formStateRestoreCallback.call(element, 'state-value', 'restore');

        expect(busListener).toHaveBeenCalledWith('state-value', 'restore');
    });

    it('warns and ignores optional lifecycle hooks without matching middleware', async () => {
        const { defineElement, onFormStateRestore } = await import('../src/index.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const listener = vi.fn();
        const tag = uniqueTag('x-bus-missing-lifecycle');
        defineElement(tag, () => {
            onFormStateRestore(listener);
            return null;
        });

        document.body.appendChild(document.createElement(tag));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not implement the requested lifecycle'));
        expect(listener).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('routes onMove middleware events to render-time subscribers via the bus', async () => {
        const { defineElement, onMove, onConnectedMove } = await import('../src/index.js');
        const busListener = vi.fn();
        const tag = uniqueTag('x-bus-move');
        defineElement(tag, [onMove()], () => {
            onConnectedMove(busListener);
            return null;
        });
        const element = document.createElement(tag);
        document.body.appendChild(element);
        const ElementConstructor = customElements.get(tag);

        ElementConstructor.prototype.connectedMoveCallback.call(element);

        expect(busListener).toHaveBeenCalledTimes(1);
    });

    it('invokes multiple listeners in registration order', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const order = [];
        const tag = uniqueTag('x-bus-order');
        defineElement(tag, () => {
            onConnect(() => order.push('first'));
            onConnect(() => order.push('second'));
            return null;
        });

        document.body.appendChild(document.createElement(tag));

        expect(order).toEqual(['first', 'second']);
    });

    it('reports a thrown listener and continues notifying later listeners', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const thrownError = new Error('listener failed');
        const nextListener = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const tag = uniqueTag('x-bus-error-continues');
        defineElement(tag, () => {
            onConnect(() => {
                throw thrownError;
            });
            onConnect(nextListener);
            return null;
        });

        document.body.appendChild(document.createElement(tag));

        expect(error).toHaveBeenCalledWith(thrownError);
        expect(nextListener).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });

    it('does not expose stale cleanup when a render-time listener is cleared on unmount', async () => {
        const { defineElement, onConnect } = await import('../src/index.js');
        const connect = vi.fn();
        let subscriptionResult;
        const tag = uniqueTag('x-bus-stale-cleanup');
        defineElement(tag, () => {
            subscriptionResult = onConnect(connect);
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);
        element.remove();
        await nextMicrotask();

        expect(subscriptionResult).toBeUndefined();

        document.body.appendChild(element);
        await nextMicrotask();

        expect(connect).toHaveBeenCalledTimes(2);
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
        const { defineElement, attributes, props, stringAttr } = await import('../src/index.js');

        let reactiveState;
        const tag = uniqueTag('x-props-adopt');
        defineElement(tag, [attributes({ value: [stringAttr[0]] })], () => {
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
        const ElementConstructor = customElements.get(tag);

        const expectedName = tag.replace(/(^|-)(\w)/g, (_match, _separator, character) => character.toUpperCase());
        expect(ElementConstructor.name).toBe(expectedName);
        expect(customElements.get(tag)).toBe(ElementConstructor);
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
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-num-in');
        defineElement(tag, [attributes({ count: [numberAttr[0]] })], () => {
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
        const { defineElement, attributes, boolAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-bool-in');
        defineElement(tag, [attributes({ open: [boolAttr[0]] })], () => {
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

    it('reflect-only [undefined, serialize] pushes prop to attribute but does not observe inbound', async () => {
        const { defineElement, attributes, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-reflect-only');
        defineElement(
            tag,
            [attributes({ count: [undefined, propertyValue => (propertyValue == null ? null : String(propertyValue))] })],
            () => {
                props({ count: 0 });
                return null;
            }
        );
        const element = document.createElement(tag);
        document.body.appendChild(element);

        // prop -> attribute reflection works
        element.count = 4;
        expect(element.getAttribute('count')).toBe('4');

        // inbound attribute change is NOT parsed back into the prop (no observe)
        element.setAttribute('count', '99');
        expect(element.count).toBe(4);
    });

    it('reflects a Number prop out to the attribute', async () => {
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-num-out');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
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

    it('reflects a String prop out to the attribute', async () => {
        const { defineElement, attributes, props, stringAttr } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-string-out');
        defineElement(tag, [attributes({ label: stringAttr })], () => {
            props({ label: '' });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.label = 'hello';
        expect(element.getAttribute('label')).toBe('hello');
    });

    it('reflects a Boolean prop out by adding/removing the attribute', async () => {
        const { defineElement, attributes, boolAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-bool-out');
        defineElement(tag, [attributes({ open: boolAttr })], () => {
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
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        let reactiveState;
        const tag = uniqueTag('x-attr-proxy');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
            reactiveState = props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        reactiveState.count++;
        expect(element.getAttribute('count')).toBe('1');
    });

    it('settles a reflected round-trip without looping', async () => {
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-roundtrip');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
            props({ count: 0 });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('count', '05');

        expect(element.count).toBe(5);
        expect(element.getAttribute('count')).toBe('5');
    });

    it('throws when a reflected parse/serialize pair is not round-trip stable', async () => {
        const { attributes } = await import('../src/index.js');
        const { MOUNT, UNMOUNT } = await import('../src/symbols.js');
        const { emit } = await import('../src/utils/pubsub.js');
        const ElementConstructor = attributes({
            value: [rawValue => rawValue?.toUpperCase(), propertyValue => String(propertyValue)],
        })(
            class {
                constructor() {
                    this[MOUNT] = [];
                    this[UNMOUNT] = [];
                    Object.defineProperty(this, 'value', {
                        configurable: true,
                        get() {
                            return 'hello';
                        },
                    });
                }
            }
        );
        const element = new ElementConstructor();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        emit(element, MOUNT);

        expect(error).toHaveBeenCalledWith(expect.any(Error));
        expect(error.mock.calls[0][0].message).toMatch(/not round-trip stable/);
        error.mockRestore();
    });

    it('warns when a reflected attribute is not declared via props()', async () => {
        const { defineElement, attributes, stringAttr } = await import('../src/index.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const tag = uniqueTag('x-attr-undeclared');
        defineElement(tag, [attributes({ ghost: stringAttr })], () => null);

        document.body.appendChild(document.createElement(tag));

        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('keeps reflecting after the element is moved to a new parent', async () => {
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-move');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
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
        const { defineElement, attributes, numberAttr, props } = await import('../src/index.js');
        let reactiveState;
        const tag = uniqueTag('x-attr-remount');
        defineElement(tag, [attributes({ count: numberAttr })], () => {
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
        const { defineElement, attributes, props, stringAttr } = await import('../src/index.js');
        const tag = uniqueTag('x-attr-observe-only');
        defineElement(tag, [attributes({ label: [stringAttr[0]] })], () => {
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
        defineElement(tag, [attributes({ csv: [rawValue => (rawValue ? rawValue.split(',') : [])] })], () => {
            props({ csv: [] });
            return null;
        });

        const element = document.createElement(tag);
        document.body.appendChild(element);

        element.setAttribute('csv', 'a,b');
        expect(element.csv).toEqual(['a', 'b']);
    });
});
