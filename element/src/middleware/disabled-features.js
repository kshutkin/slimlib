/** @typedef {import('../types.js').Middleware} Middleware */

/**
 * @param {string[]} features
 * @returns {Middleware}
 */
export const disabledFeatures = features => Base =>
    class extends Base {
        static disabledFeatures = features;
    };
