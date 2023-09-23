import { signal, DestroyRef, inject, type ProviderToken, type Signal, untracked, computed } from '@angular/core';
import { type Store, createStoreFactory } from './core';

export type InjectorLike = {
    get: {
        <T>(token: ProviderToken<T>): T;
    }
};

export const createStore = createStoreFactory(false);

export const toSignal = <T>(store: Store<T>, injector?: InjectorLike) => {
    const cleanupRef = (injector ? injector.get : inject)(DestroyRef);

    const state = signal<T>(store());

    untracked(() => {
        cleanupRef?.onDestroy(store((value: T) => {
            state.set(value);
        }));
    });
    
    return state.asReadonly();
};

type SignalValue<T extends Signal<unknown>> = T extends Signal<infer Value> ? Value : never;

type ArrayOfSignalValues<T extends Signal<unknown>[]> = { [S in keyof T]: SignalValue<T[S]> }

type Prepend<I, T extends unknown[]> = [I, ...T];

type SignalsProjector<Signals extends Signal<unknown>[], Result, State> = (
    ...values: Prepend<State, ArrayOfSignalValues<Signals>>
  ) => Result;

export class SlimlibStore<T extends object> {
    private readonly store: Store<T>;
    protected readonly state: T;
    public readonly signal: Signal<T>;

    constructor(initialState: T) {
        [this.state, this.store] = createStore<T>(initialState);
        this.signal = toSignal(this.store);
    }

    select<P extends Signal<unknown>[], R>(...selectors: [...signals: P, projector: SignalsProjector<P, R, T>]) {
        // eslint-disable-next-line @typescript-eslint/ban-types
        const projector = selectors.pop() as Function;
        return computed<R>(() => {
            const values = (selectors as unknown as P).map(selector => selector());
            return projector(this.signal(), ...values);
        });
    }
}