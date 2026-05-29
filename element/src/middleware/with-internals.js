/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @returns {Middleware}
 */
export const withInternals = () => Base =>
    class extends Base {
        constructor() {
            super();
            /** @type {SlimHost & { _internals: ElementInternals }} */ (/** @type {unknown} */ (this))._internals = this.attachInternals();
        }
    };
