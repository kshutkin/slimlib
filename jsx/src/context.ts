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

export const inject = <T>(context: Context<T>): T | undefined => {
    const values = findContextValues(activeScope);
    return values === undefined ? undefined : (values[context] as T | undefined);
};
