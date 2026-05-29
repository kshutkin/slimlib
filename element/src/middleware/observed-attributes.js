/** @typedef {import('../types.js').Middleware} Middleware */

/**
 * @param {string[]} attrs
 * @returns {Middleware}
 */
export const observedAttributes = attrs => Base =>
    class extends Base {
        static get observedAttributes() {
            return attrs;
        }
    };
