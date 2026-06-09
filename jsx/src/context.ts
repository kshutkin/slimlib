import { setContextHooks } from './core';

export type Context<T> = {
    readonly $_default: T;
};

let currentContext: Map<Context<unknown>, unknown> | undefined;
let hooksInstalled = false;

const capture = (): Map<Context<unknown>, unknown> | undefined =>
    currentContext === undefined ? undefined : new Map(currentContext);

const run = <T>(snapshot: unknown, fn: () => T): T => {
    const previous = currentContext;
    currentContext = snapshot as Map<Context<unknown>, unknown> | undefined;
    try {
        return fn();
    } finally {
        currentContext = previous;
    }
};

export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T = undefined>(): Context<T | undefined>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
    return { $_default: defaultValue };
}

export const getContext = <T>(context: Context<T>): T => {
    if (currentContext !== undefined && currentContext.has(context as Context<unknown>)) {
        return currentContext.get(context as Context<unknown>) as T;
    }
    return context.$_default;
};

export const provideContext = <T, R>(context: Context<T>, value: T, fn: () => R): R => {
    if (!hooksInstalled) {
        hooksInstalled = true;
        setContextHooks({ $_capture: capture, $_run: run });
    }
    const previousContext = currentContext;
    const nextContext = currentContext === undefined ? new Map<Context<unknown>, unknown>() : new Map(currentContext);
    nextContext.set(context as Context<unknown>, value);
    currentContext = nextContext;
    try {
        return fn();
    } finally {
        currentContext = previousContext;
    }
};
