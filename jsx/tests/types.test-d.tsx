import { expectTypeOf, it } from 'vitest';

import { createContext, createElement, Fragment, inject, Provider, RootProvider, render } from '@slimlib/jsx';

import type { Child, Component, Context, Props, ProviderProps, Reactive, RootProviderProps } from '@slimlib/jsx';
import type { forEach } from '@slimlib/jsx/for-each';
import type { JSX } from '@slimlib/jsx/jsx-runtime';

// ── 1. createElement ──────────────────────────────────────────────────────────

it('createElement returns Node and is generic over P extends Props', () => {
    // Test via type-only assertions — never call the function (requires DOM)
    expectTypeOf(createElement).returns.toEqualTypeOf<Node>();
    expectTypeOf(createElement).toBeCallableWith('div', null);
    expectTypeOf(createElement).toBeCallableWith('div', null, 'child1', 'child2');
});

// ── 2. Child type ─────────────────────────────────────────────────────────────

it('Child can be string, number, null, Node, function returning Child, or array', () => {
    expectTypeOf<string>().toMatchTypeOf<Child>();
    expectTypeOf<number>().toMatchTypeOf<Child>();
    expectTypeOf<bigint>().toMatchTypeOf<Child>();
    expectTypeOf<boolean>().toMatchTypeOf<Child>();
    expectTypeOf<null>().toMatchTypeOf<Child>();
    expectTypeOf<undefined>().toMatchTypeOf<Child>();
    expectTypeOf<() => Child>().toMatchTypeOf<Child>();
    expectTypeOf<Child[]>().toMatchTypeOf<Child>();
});

// ── 3. Props type ─────────────────────────────────────────────────────────────

it('Props has optional children and is extendable', () => {
    type MyProps = Props & { label: string };
    expectTypeOf<MyProps['label']>().toEqualTypeOf<string>();
    expectTypeOf<MyProps['children']>().toEqualTypeOf<Child | undefined>();
});

// ── 4. Reactive<T> ────────────────────────────────────────────────────────────

it('Reactive<T> is T or a function returning T', () => {
    expectTypeOf<string>().toMatchTypeOf<Reactive<string>>();
    expectTypeOf<() => string>().toMatchTypeOf<Reactive<string>>();
    // @ts-expect-error - number is not Reactive<string>
    const invalid: Reactive<string> = 42 as number;
    void invalid;
});

// ── 5. Component<P> ───────────────────────────────────────────────────────────

it('Component<P> is a function from P to Child', () => {
    type ButtonProps = Props & { label: string };
    expectTypeOf<Component<ButtonProps>>().toEqualTypeOf<(props: ButtonProps) => Child>();
});

// ── 6. JSX intrinsic elements via JSX.IntrinsicElements ──────────────────────

it('JSX intrinsic elements accept class, style, ref and arbitrary attributes', () => {
    type DivProps = JSX.IntrinsicElements['div'];
    expectTypeOf<DivProps['class']>().toEqualTypeOf<Reactive<string> | undefined>();
    expectTypeOf<DivProps['className']>().toEqualTypeOf<Reactive<string> | undefined>();
    expectTypeOf<DivProps['style']>().toEqualTypeOf<Reactive<string> | undefined>();
    expectTypeOf<NonNullable<DivProps['ref']>>().toEqualTypeOf<(el: globalThis.Element | null) => void>();
    // arbitrary keys via index signature — any unknown value is allowed
    expectTypeOf<DivProps['on:click']>().toEqualTypeOf<unknown>();
});

// ── 7. createElement enforces required props for typed components ─────────────

it('createElement enforces required props for typed components', () => {
    type ButtonProps = Props & { label: string };
    const Button: Component<ButtonProps> = _props => null;

    // Button's props type requires 'label'
    expectTypeOf(Button).parameter(0).toMatchTypeOf<{ label: string }>();

    // Constructing incomplete props is a type error
    // @ts-expect-error - {} is missing required property 'label'
    const incomplete: ButtonProps = {};
    void incomplete;
    void Button;
});

// ── 8. render function ────────────────────────────────────────────────────────

it('render accepts () => Child and Element | DocumentFragment, returns () => void', () => {
    expectTypeOf(render).toEqualTypeOf<(factory: () => Child, container: Element | DocumentFragment) => () => void>();
});

// ── 9. Fragment ───────────────────────────────────────────────────────────────

it('Fragment is a Component accepting optional children', () => {
    expectTypeOf(Fragment).toEqualTypeOf<Component<{ children?: Child }>>();
});

// ── 10. forEach ───────────────────────────────────────────────────────────────

it('forEach correctly infers T from the array type', () => {
    type Item = { id: number; name: string };
    // Return type is DocumentFragment regardless of T
    expectTypeOf<ReturnType<typeof forEach<Item>>>().toEqualTypeOf<DocumentFragment>();
    // The key callback (2nd arg) receives item as T and index as number
    type KeyFn = Parameters<typeof forEach<Item>>[1];
    expectTypeOf<Parameters<KeyFn>[0]>().toEqualTypeOf<Item>();
    expectTypeOf<Parameters<KeyFn>[1]>().toEqualTypeOf<number>();
    // The body callback (3rd arg) receives item as () => T and index as () => number
    type BodyFn = Parameters<typeof forEach<Item>>[2];
    expectTypeOf<Parameters<BodyFn>[0]>().toEqualTypeOf<() => Item>();
    expectTypeOf<Parameters<BodyFn>[1]>().toEqualTypeOf<() => number>();
});

// ── 11. context ──────────────────────────────────────────────────────────────

it('context API preserves value types', () => {
    const Theme = createContext<'dark' | 'light'>();
    const Count = createContext<number>();

    expectTypeOf(Theme).toMatchTypeOf<Context<'dark' | 'light'>>();
    expectTypeOf<ProviderProps<'dark' | 'light'>['context']>().toEqualTypeOf<Context<'dark' | 'light'>>();
    expectTypeOf(inject(Theme)).toEqualTypeOf<'dark' | 'light' | undefined>();
    expectTypeOf(inject(Count)).toEqualTypeOf<number | undefined>();

    const themeProps: ProviderProps<'dark' | 'light'> = { context: Theme, value: 'dark', children: () => null };
    const countProps: ProviderProps<number> = { context: Count, value: 1, children: () => null };
    void themeProps;
    void countProps;

    // @ts-expect-error - provider value must match the context type
    const invalidThemeProps: ProviderProps<'dark' | 'light'> = { context: Theme, value: 'blue', children: () => null };
    void invalidThemeProps;

    // @ts-expect-error - provider value must match the context type
    const invalidCountProps: ProviderProps<number> = { context: Count, value: '1', children: () => null };
    void invalidCountProps;

    // @ts-expect-error - provider children must be lazy
    const invalidChildrenProps: ProviderProps<'dark' | 'light'> = { context: Theme, value: 'dark', children: null };
    void invalidChildrenProps;

    void Provider;
});

// ── 12. RootProvider ─────────────────────────────────────────────────────────

it('RootProvider factory API preserves value types', () => {
    const Theme = createContext<'dark' | 'light'>();

    expectTypeOf<RootProviderProps<'dark' | 'light'>['context']>().toEqualTypeOf<Context<'dark' | 'light'>>();

    const themeProps: RootProviderProps<'dark' | 'light'> = { context: Theme, factory: () => 'dark', children: () => null };
    void themeProps;

    // @ts-expect-error - factory value must match the context type
    const invalidThemeProps: RootProviderProps<'dark' | 'light'> = { context: Theme, factory: () => 'blue', children: () => null };
    void invalidThemeProps;

    // @ts-expect-error - root provider children must be lazy
    const invalidChildrenProps: RootProviderProps<'dark' | 'light'> = { context: Theme, factory: () => 'dark', children: null };
    void invalidChildrenProps;

    void RootProvider;
});
