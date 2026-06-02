import { expectTypeOf, it } from 'vitest';

import { attributes, booleanAttribute, createCustomElement, numberAttribute, stringAttribute, withValidation } from '@slimlib/element';

import type { RenderFunction } from '@slimlib/element';

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
