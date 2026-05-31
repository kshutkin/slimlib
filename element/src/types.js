/**
 * @typedef {HTMLElement & Record<string, unknown>} ElementHost
 */

/**
 * @typedef {(host: ElementHost) => unknown} RenderFunction
 */

/**
 * @template {object} [InstanceExt={}]
 * @typedef {((ElementBase: CustomElementConstructor) => CustomElementConstructor) & { readonly __instanceExt?: InstanceExt }} Middleware
 */

export {};
