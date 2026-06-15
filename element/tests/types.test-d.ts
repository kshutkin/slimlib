import { expectTypeOf, it } from 'vitest';

import {
    attributes,
    booleanAttribute,
    ContextRequestEvent,
    contextProvider,
    createContext,
    createCustomElement,
    numberAttribute,
    requestContext,
    stringAttribute,
    withValidation,
} from '@slimlib/element';

import type { Context, ContextCallback, ContextType, ElementHost, RenderFunction, UnknownContext } from '@slimlib/element';

// createCustomElement uses HTMLElement as the default ElementBase — stub it for Node.js
if (typeof HTMLElement === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: test stub for Node.js env
    (globalThis as any).HTMLElement = class HTMLElement {};
}

const renderFn = (() => null) as unknown as RenderFunction;

it('createCustomElement without middleware returns HTMLElement constructor', () => {
    const El = createCustomElement(renderFn);
    expectTypeOf<InstanceType<typeof El>>().toExtend<HTMLElement>();
});

it('count attribute is number | null', () => {
    const El = createCustomElement([attributes({ count: numberAttribute })], renderFn);
    expectTypeOf<InstanceType<typeof El>['count']>().toEqualTypeOf<number | null>();
});

it('active attribute is boolean', () => {
    const El = createCustomElement([attributes({ active: booleanAttribute })], renderFn);
    expectTypeOf<InstanceType<typeof El>['active']>().toEqualTypeOf<boolean>();
});

it('label attribute is string | null', () => {
    const El = createCustomElement([attributes({ label: stringAttribute })], renderFn);
    expectTypeOf<InstanceType<typeof El>['label']>().toEqualTypeOf<string | null>();
});

it('multiple attributes in one config', () => {
    const El = createCustomElement([attributes({ count: numberAttribute, active: booleanAttribute })], renderFn);
    expectTypeOf<InstanceType<typeof El>['count']>().toEqualTypeOf<number | null>();
    expectTypeOf<InstanceType<typeof El>['active']>().toEqualTypeOf<boolean>();
});

it('two separate attributes middleware merge on instance', () => {
    const El = createCustomElement([attributes({ count: numberAttribute }), attributes({ label: stringAttribute })], renderFn);
    expectTypeOf<InstanceType<typeof El>['count']>().toEqualTypeOf<number | null>();
    expectTypeOf<InstanceType<typeof El>['label']>().toEqualTypeOf<string | null>();
});

it('withValidation exposes constraint validation on the instance', () => {
    const El = createCustomElement([withValidation()], renderFn);
    expectTypeOf<InstanceType<typeof El>['validity']>().toEqualTypeOf<ValidityState>();
    expectTypeOf<InstanceType<typeof El>['validationMessage']>().toEqualTypeOf<string>();
    expectTypeOf<InstanceType<typeof El>['willValidate']>().toEqualTypeOf<boolean>();
    expectTypeOf<InstanceType<typeof El>['form']>().toEqualTypeOf<HTMLFormElement | null>();
    expectTypeOf<InstanceType<typeof El>['labels']>().toEqualTypeOf<NodeList>();
    expectTypeOf<InstanceType<typeof El>['checkValidity']>().toEqualTypeOf<() => boolean>();
    expectTypeOf<InstanceType<typeof El>['reportValidity']>().toEqualTypeOf<() => boolean>();
});

it('context protocol API preserves value types', () => {
    const Theme = createContext<'dark' | 'light'>('theme');
    const Count = createContext<number>(Symbol('count'));

    expectTypeOf(Theme).toMatchTypeOf<Context<unknown, 'dark' | 'light'>>();
    expectTypeOf(Theme).toMatchTypeOf<UnknownContext>();
    expectTypeOf<ContextType<typeof Theme>>().toEqualTypeOf<'dark' | 'light'>();
    expectTypeOf<ContextType<typeof Count>>().toEqualTypeOf<number>();
    expectTypeOf(requestContext(Theme)).toEqualTypeOf<'dark' | 'light' | undefined>();
    expectTypeOf(requestContext(Count)).toEqualTypeOf<number | undefined>();

    const themeProvider = contextProvider(Theme, host => {
        expectTypeOf(host).toEqualTypeOf<ElementHost>();
        return 'dark';
    });
    void themeProvider;

    new ContextRequestEvent(Count, value => {
        expectTypeOf(value).toEqualTypeOf<number>();
    });

    const countCallback: ContextCallback<number> = value => value.toFixed();
    new ContextRequestEvent(Count, countCallback, true);

    // @ts-expect-error - provider factory value must match the context type
    contextProvider(Theme, () => 'blue');

    // @ts-expect-error - request callback value must match the context type
    new ContextRequestEvent(Count, (value: string) => value);
});
