import { createElement, Fragment } from './create-element';
import type { Child, ElementType, Props } from './types';

// Modern JSX transform entry points. The implementation delegates to
// createElement; jsxs is identical to jsx in this minimal scaffold.

export const jsx = <P extends Props>(type: ElementType<P>, props: P, _key?: string): Node => {
    const { children, ...rest } = props as Props;
    const childArray: Child[] = children === undefined ? [] : Array.isArray(children) ? children : [children];
    return createElement(type, rest as P, ...childArray);
};

export const jsxs = jsx;
export const jsxDEV = jsx;
export { Fragment };
