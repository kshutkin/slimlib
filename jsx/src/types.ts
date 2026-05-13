export type Primitive = string | number | bigint | boolean | null | undefined;

export type Child = Node | Primitive | (() => Child) | Child[];

export type Props = Record<string, unknown> & { children?: Child };

export type Component<P extends Props = Props> = (props: P) => Child;

export const FRAGMENT = Symbol.for('@slimlib/jsx.fragment');
export type Fragment = typeof FRAGMENT;

export type ElementType<P extends Props = Props> = string | Component<P> | Fragment;
