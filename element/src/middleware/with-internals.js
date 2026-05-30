/** @typedef {import('../types.js').Middleware} Middleware */
import { INTERNALS } from '../symbols.js';

/**
 * @returns {Middleware}
 */
export const withInternals = () => ElementBase =>
    class extends ElementBase {
        [INTERNALS] = this.attachInternals();
    };
