/**
 * Internal symbols used for the reactive system
 * @module symbols
 */

export const [
    unwrap,
    // Linked list pointers for dependencies (what this node depends on)
    deps, // Head of deps linked list
    depsTail, // Tail of deps linked list (also used as cursor during tracking)
    // Linked list pointers for subscribers (who depends on this node)
    subs, // Head of subs linked list
    subsTail, // Tail of subs linked list
    // Node properties
    flagsSymbol,
    lastGlobalVersionSymbol,
    getterSymbol,
    equalsSymbol,
    valueSymbol,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
    versionSymbol,
] = /** @type {[symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol]}*/ (
    Array.from({ length: 14 }, () => Symbol())
);
