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

type ContextValues = Map<Context<unknown>, unknown>;
type NoInferValue<T> = [T][T extends unknown ? 0 : never];

export type ProviderProps<T> = Props & {
    context: Context<T>;
    value: NoInferValue<T>;
    children: () => Child;
};

const contextValuesSymbol = Symbol();

export const createContext = <T>(): Context<T> => Symbol() as Context<T>;

export const Provider = <T>(props: ProviderProps<T>): Child => {
    if (DEV && typeof props.children !== 'function') {
        throw new Error('Provider: children must be a function');
    }
    return () => {
        if (DEV && activeScope === undefined) {
            throw new Error('Provider must be rendered inside a scope');
        }
        const scope = activeScope as Scope;
        let values = scope[contextValuesSymbol] as ContextValues | undefined;
        if (values === undefined) {
            values = new Map();
            scope[contextValuesSymbol] = values;
        }
        values.set(props.context as Context<unknown>, props.value);
        return props.children();
    };
};

export const inject = <T>(context: Context<T>): T | undefined => {
    for (let cursor: ScopeParent | undefined = activeScope; cursor !== undefined; cursor = getParentScope(cursor)) {
        const values = cursor[contextValuesSymbol] as ContextValues | undefined;
        if (values?.has(context as Context<unknown>)) {
            return values.get(context as Context<unknown>) as T;
        }
    }
    return undefined;
};
