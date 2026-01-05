// Type declarations for store symbols
// These are declared as unique symbols so they can be used as index types

declare const unwrap: unique symbol;
declare const sources: unique symbol;
declare const dependencies: unique symbol;
declare const flagsSymbol: unique symbol;
declare const skippedDeps: unique symbol;
declare const weakRefSymbol: unique symbol;
declare const lastGlobalVersionSymbol: unique symbol;
declare const getterSymbol: unique symbol;
declare const equalsSymbol: unique symbol;
declare const valueSymbol: unique symbol;

export {
    unwrap,
    sources,
    dependencies,
    flagsSymbol,
    skippedDeps,
    weakRefSymbol,
    lastGlobalVersionSymbol,
    getterSymbol,
    equalsSymbol,
    valueSymbol,
};
