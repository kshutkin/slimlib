/**
 * Symbol keys for the internal lifecycle message bus. Each message type owns a
 * dedicated symbol so its listeners live in an isolated `host[symbol]` array and
 * `emit` never has to inspect other message types.
 */

export const [MOUNT, UNMOUNT, CONNECT, DISCONNECT, ADOPTED, MOVE, FORM_ASSOCIATED, FORM_DISABLED, FORM_RESET, FORM_STATE_RESTORE] =
    /** @type {[symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol]} */ (
        Array.from({ length: 10 }, () => Symbol())
    );