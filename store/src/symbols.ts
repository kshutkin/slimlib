// Symbols for exposed objects and private lifecycle markers
// These must remain symbols to avoid leaking internal implementation details
export const [
    unwrap,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
    parentSymbol,
    skipScopeRemoval,
    // biome-ignore lint/suspicious/noSparseArray: fine
] = Array.from([, , , , , ,], Symbol) as [symbol, symbol, symbol, symbol, symbol, symbol];
