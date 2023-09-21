import { signal, DestroyRef, inject, type ProviderToken, type Signal, untracked } from '@angular/core';
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

export class SlimlibStore<T extends object> {
    private readonly store: Store<T>;
    protected readonly state: T;
    public readonly signal: Signal<T>;

    constructor(initialState: T) {
        [this.state, this.store] = createStore<T>(initialState);
        this.signal = toSignal(this.store);
    }
}