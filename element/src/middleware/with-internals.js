/** @typedef {import('../types.js').Middleware} Middleware */
/** @typedef {import('../types.js').SlimHost} SlimHost */

/**
 * @returns {Middleware}
 */
export const withInternals = () => ElementBase =>
    class extends ElementBase {
        constructor() {
            super();
            /** @type {SlimHost & { _internals: ElementInternals }} */ (/** @type {unknown} */ (this))._internals = this.attachInternals();
        }
    };
