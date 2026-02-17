// Symbols for objects that ARE exposed to users
// These must remain symbols to avoid leaking internal implementation details
export const [
    unwrap,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
    // biome-ignore lint/suspicious/noSparseArray: fine
] = Array.from([, , , ,], Symbol) as [symbol, symbol, symbol, symbol];
