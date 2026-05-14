declare module '@slimlib/jsx' {
	/**
	 * Fragment is a no-op component that simply returns its children.
	 * No special-case in the renderer; treated as any other component.
	 */
	export const Fragment: Component<{
		children?: Child;
	}>;
	/** Build a Node for a JSX element. Uses module-level scope state. */
	export const createElement: <P extends Props>(type: ElementType<P>, props: P | null, ...children: Child[]) => Node;
	/**
	 * Mount JSX into `container`. The first argument must be a function that produces
	 * the JSX tree — this ensures reactive bindings are created inside the render scope
	 * so they can be torn down on dispose. Returns a dispose function.
	 *
	 * Usage: `render(() => <App />, document.body)`
	 */
	export const render: (factory: () => Child, container: Element | DocumentFragment) => (() => void);
	export type Primitive = string | number | bigint | boolean | null | undefined;
	export type Child = Node | Primitive | (() => Child) | Child[];
	export type Props = Record<string, unknown> & {
		children?: Child;
	};
	export type Component<P extends Props = Props> = (props: P) => Child;
	export type ElementType<P extends Props = Props> = string | Component<P>;

	export {};
}

declare module '@slimlib/jsx/jsx-runtime' {
	export const jsx: <P extends Props>(type: ElementType<P>, props: P, _key?: string) => Node;
	export const jsxs: <P extends Props>(type: ElementType<P>, props: P, _key?: string) => Node;
	export const jsxDEV: <P extends Props>(type: ElementType<P>, props: P, _key?: string) => Node;
	/**
	 * Fragment is a no-op component that simply returns its children.
	 * No special-case in the renderer; treated as any other component.
	 */
	export const Fragment: Component<{
		children?: Child;
	}>;
	type Primitive = string | number | bigint | boolean | null | undefined;
	type Child = Node | Primitive | (() => Child) | Child[];
	type Props = Record<string, unknown> & {
		children?: Child;
	};
	type Component<P extends Props = Props> = (props: P) => Child;
	type ElementType<P extends Props = Props> = string | Component<P>;

	export {};
}

//# sourceMappingURL=index.d.ts.map