/**
 * Symbol keys for the internal lifecycle message bus. Each message type owns a
 * dedicated symbol so its listeners live in an isolated `host[symbol]` array and
 * `emit` never has to inspect other message types.
 */

export const MOUNT = Symbol();
export const UNMOUNT = Symbol();
export const CONNECT = Symbol();
export const DISCONNECT = Symbol();
export const ADOPTED = Symbol();
export const MOVE = Symbol();
export const FORM_ASSOCIATED = Symbol();
export const FORM_DISABLED = Symbol();
export const FORM_RESET = Symbol();
export const FORM_STATE_RESTORE = Symbol();
