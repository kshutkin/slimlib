/**
 * Internal symbol keys for the package.
 *
 * Lifecycle message-bus keys: each message type owns a dedicated symbol so its
 * listeners live in an isolated `host[symbol]` array and `emit` never has to
 * inspect other message types.
 */

export const [MOUNT, UNMOUNT, CONNECT, DISCONNECT, ADOPTED, MOVE, FORM_ASSOCIATED, FORM_DISABLED, FORM_RESET, FORM_STATE_RESTORE, RENDER_GEN] =
    /** @type {[symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol]} */ (
        Array.from({ length: 11 }, () => Symbol())
    );
