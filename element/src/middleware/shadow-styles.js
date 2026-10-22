import { RENDER_ROOT } from '../symbols.js';

/** @typedef {import('../types.js').Middleware} Middleware */

/**
 * Render inside an open shadow root and adopt the given stylesheets.
 *
 * @param {CSSStyleSheet[]} sheets
 * @returns {Middleware}
 */
export const shadowStyles = sheets => ElementBase =>
    class extends ElementBase {
        constructor() {
            super();
            const root = this.attachShadow({ mode: 'open' });
            root.adoptedStyleSheets = sheets;
            /** @type {Record<symbol, ShadowRoot>} */ (/** @type {unknown} */ (this))[RENDER_ROOT] = root;
        }
    };
