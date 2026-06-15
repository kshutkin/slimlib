import { DEV } from 'esm-env';

import { activeScope, getParentScope } from '@slimlib/store';

import type { Scope, ScopeParent } from '@slimlib/store';
import type { Child, Props } from './types';

declare const contextType: unique symbol;

export type Context<T> = symbol & {
    readonly [contextType]: {
        readonly $_value: T;
        readonly $_type: (value: T) => T;
    };
};

type ContextValues = Record<symbol, unknown>;
type NoInferValue<T> = [T][T extends unknown ? 0 : never];

export type ProviderProps<T> = Props & {
    context: Context<T>;
    value: NoInferValue<T>;
    children: () => Child;
};

export type RootProviderProps<T> = Props & {
    context: Context<T>;
    factory: () => NoInferValue<T>;
    children: () => Child;
};

const contextValuesSymbol = Symbol();

const findContextValues = (cursor: ScopeParent | undefined): ContextValues | undefined => {
    let values: ContextValues | undefined;
    // biome-ignore lint/suspicious/noAssignInExpressions: compact hot-path scan
    while (cursor !== undefined && (values = cursor[contextValuesSymbol] as ContextValues | undefined) === undefined) {
        cursor = getParentScope(cursor);
    }
    return values;
};

export const createContext = <T>(): Context<T> => Symbol() as Context<T>;

export const Provider = <T>(props: ProviderProps<T>): Child => {
    if (DEV && typeof props.children !== 'function') {
        throw new Error('Provider: children must be a function');
    }
    return () => {
        if (DEV && activeScope === undefined) {
            throw new Error('Provider must be rendered inside a scope');
        }
        let values = (activeScope as Scope)[contextValuesSymbol] as ContextValues | undefined;
        if (values === undefined) {
            values = Object.create(findContextValues(activeScope as Scope) ?? null) as ContextValues;
            (activeScope as Scope)[contextValuesSymbol] = values;
        }
        values[props.context] = props.value;
        return props.children();
    };
};

export const RootProvider = <T>(props: RootProviderProps<T>): Child => {
    if (DEV && typeof props.children !== 'function') {
        throw new Error('RootProvider: children must be a function');
    }
    // Memoizes the delegated Provider thunk so the factory runs at most once per
    // instance and only after this element has actually won the ancestor probe.
    let provide: (() => Child) | undefined;
    return () => {
        if (DEV && activeScope === undefined) {
            throw new Error('RootProvider must be rendered inside a scope');
        }
        const values = findContextValues(activeScope);
        // Stay transparent when any ancestor scope already provides this context.
        // Presence is detected by key, so an ancestor that deliberately provides
        // `undefined` is respected rather than overridden.
        if (values !== undefined && props.context in values) {
            return props.children();
        }
        provide ??= Provider({ ...props, value: props.factory() }) as () => Child;
        return provide();
    };
};

export const inject = <T>(context: Context<T>): T | undefined => {
    const values = findContextValues(activeScope);
    return values === undefined ? undefined : (values[context] as T | undefined);
};
