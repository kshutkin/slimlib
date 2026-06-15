/**
 * @template {UnknownContext} T
 * @typedef {import('./context-types.js').ContextType<T>} ContextType
 */
/**
 * @template ValueType
 * @typedef {import('./context-types.js').ContextCallback<ValueType>} ContextCallback
 */
/** @typedef {import('./context-types.js').UnknownContext} UnknownContext */

/**
 * Web Components Context Protocol `context-request` event.
 *
 * @template {UnknownContext} T
 * @extends {Event}
 */
export class ContextRequestEvent extends Event {
    /**
     * @param {T} context
     * @param {ContextCallback<ContextType<T>>} callback
     * @param {boolean} [subscribe]
     */
    constructor(context, callback, subscribe) {
        super('context-request', { bubbles: true, composed: true });
        this.context = context;
        this.callback = callback;
        this.subscribe = subscribe;
    }
}
