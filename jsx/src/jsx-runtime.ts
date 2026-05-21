import { createElementArray, Fragment } from './core';
import type { Child, ElementType, Props } from './types';

// Modern JSX transform entry points. We share one implementation across
// jsx / jsxs / jsxDEV so V8 keeps a single, well-trained inline cache —
// splitting them into specialized bodies fragmented the IC and lost more
// than the avoided type check saved (measured).
//
// The shared body calls createElementArray, which accepts a pre-collected
// children array — avoiding the rest/spread roundtrip that the public
// createElement(varargs) entry incurs.

export const jsx = <P extends Props>(type: ElementType<P>, props: P, _key?: string): Node => {
    const { children, ...rest } = props as Props;
    const childArray: Child[] = children === undefined ? [] : Array.isArray(children) ? children : [children];
    return createElementArray(type, rest as unknown as P, childArray);
};

export const jsxs = jsx;
export const jsxDEV = jsx;
export { Fragment };
