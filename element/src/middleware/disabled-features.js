/** @typedef {import('../types.js').Middleware} Middleware */

/**
 * @param {string[]} features
 * @returns {Middleware}
 */
export const disabledFeatures = features => ElementBase =>
    class extends ElementBase {
        static disabledFeatures = features;
    };
