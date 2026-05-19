import { createElementArray, Fragment } from './core.js';

/** @typedef {import('./types.js').Child} Child */
/** @typedef {import('./types.js').Props} Props */
/**
 * @template {Props} [P=Props]
 * @typedef {import('./types.js').ElementType<P>} ElementType
 */

// Modern JSX transform entry points. We share one implementation across
// jsx / jsxs / jsxDEV so V8 keeps a single, well-trained inline cache —
// splitting them into specialized bodies fragmented the IC and lost more
// than the avoided type check saved (measured).
//
// The shared body calls createElementArray, which accepts a pre-collected
// children array — avoiding the rest/spread roundtrip that the public
// createElement(varargs) entry incurs.

/**
 * @template {Props} P
 * @param {ElementType<P>} type
 * @param {P} props
 * @param {string} [_key]
 * @returns {Node}
 */
export const jsx = (type, props, _key) => {
    const { children, ...rest } = /** @type {Props} */ (props);
    /** @type {Child[]} */
    const childArray = children === undefined ? [] : Array.isArray(children) ? children : [children];
    return createElementArray(type, /** @type {P} */ (rest), childArray);
};

export const jsxs = jsx;
export const jsxDEV = jsx;
export { Fragment };
