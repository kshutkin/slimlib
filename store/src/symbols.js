export const [
    unwrap,
    sources,
    dependencies,
    flagsSymbol,
    skippedDeps,
    lastGlobalVersionSymbol,
    getterSymbol,
    equalsSymbol,
    valueSymbol,
    propertyDepsSymbol,
    trackSymbol,
    childrenSymbol,
    versionSymbol,
    depsVersionSymbol,
] = /** @type {[symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol]}*/ (
    Array.from({ length: 14 }, () => Symbol())
);