import { afterEach, describe, expect, it, vi } from 'vitest';

import { contextProvider, createContext, defineElement, requestContext, rootContextProvider, withValidation } from '@slimlib/element';
import { createElement } from '@slimlib/jsx';

vi.mock('esm-env', () => ({ DEV: true }));

let counter = 0;
const uniqueTag = baseName => `${baseName}-${++counter}`;

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('context providers through the public API', () => {
    it('passes an unrelated context request to the matching ancestor provider', () => {
        const Theme = createContext(Symbol('theme'));
        const Service = createContext(Symbol('service'));
        const consumerTag = uniqueTag('x-public-context-consumer');
        const innerTag = uniqueTag('x-public-context-inner');
        const outerTag = uniqueTag('x-public-context-outer');
        let theme;
        let service;

        defineElement(consumerTag, () => {
            theme = requestContext(Theme);
            service = requestContext(Service);
            return null;
        });
        defineElement(innerTag, [contextProvider(Service, () => 'service')], () => createElement(consumerTag, null));
        defineElement(outerTag, [contextProvider(Theme, () => 'dark')], () => createElement(innerTag, null));

        document.body.appendChild(document.createElement(outerTag));

        expect(theme).toBe('dark');
        expect(service).toBe('service');
    });

    it.each([false, true])('preserves the root-provider decision after reconnecting (ancestor provider: %s)', async hasAncestor => {
        const Context = createContext(Symbol('reconnected-context'));
        const consumerTag = uniqueTag('x-public-root-consumer');
        const providerTag = uniqueTag('x-public-root-provider');
        const ancestorTag = uniqueTag('x-public-root-ancestor');
        const rootValue = {};
        const ancestorValue = {};
        const factory = vi.fn(() => rootValue);
        const received = [];

        defineElement(consumerTag, () => {
            received.push(requestContext(Context));
            return null;
        });
        defineElement(providerTag, [rootContextProvider(Context, factory)], () => createElement(consumerTag, null));
        defineElement(ancestorTag, [contextProvider(Context, () => ancestorValue)], () => null);

        const ancestor = document.createElement(ancestorTag);
        document.body.appendChild(ancestor);
        const parent = hasAncestor ? ancestor : document.body;
        const provider = document.createElement(providerTag);
        parent.appendChild(provider);

        provider.remove();
        await Promise.resolve();
        parent.appendChild(provider);

        const expected = hasAncestor ? ancestorValue : rootValue;
        expect(received).toHaveLength(2);
        expect(received[0]).toBe(expected);
        expect(received[1]).toBe(expected);
        expect(factory).toHaveBeenCalledTimes(hasAncestor ? 0 : 1);
    });
});

describe('validation diagnostics through the public API', () => {
    it.each([
        ['validity', element => element.validity],
        ['validationMessage', element => element.validationMessage],
        ['willValidate', element => element.willValidate],
        ['form', element => element.form],
        ['labels', element => element.labels],
        ['checkValidity()', element => element.checkValidity()],
        ['reportValidity()', element => element.reportValidity()],
    ])('reports missing withInternals() when accessing %s', (_name, access) => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const tag = uniqueTag('x-public-validation-no-internals');
        defineElement(tag, [withValidation()], () => null);
        const element = document.createElement(tag);

        expect(access(element)).toBeUndefined();
        expect(error).toHaveBeenCalledExactlyOnceWith('withValidation() requires the withInternals() middleware');
    });
});
