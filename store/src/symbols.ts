// Symbols for objects that ARE exposed to users
// These must remain symbols to avoid leaking internal implementation details
export const [
    unwrap,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
] = Array.from({ length: 4 }, () => Symbol()) as [
    symbol,
    symbol,
    symbol,
    symbol,
];