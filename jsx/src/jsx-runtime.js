import { createElement, Fragment } from './create-element.js';

/** @typedef {import('./types.js').Child} Child */
/** @typedef {import('./types.js').Props} Props */
/**
 * @template {Props} [P=Props]
 * @typedef {import('./types.js').ElementType<P>} ElementType
 */

// Modern JSX transform entry points. The implementation delegates to
// createElement; jsxs is identical to jsx in this minimal scaffold.

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
    return createElement(type, /** @type {P} */ (rest), ...childArray);
};

export const jsxs = jsx;
export const jsxDEV = jsx;
export { Fragment };
