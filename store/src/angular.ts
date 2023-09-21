import { signal, DestroyRef, inject, type ProviderToken, type Signal } from '@angular/core';
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

    const stateRef = new WeakRef(state);

    const unsubscribe = store((value: T) => {
        const stateSignal = stateRef.deref();
        if (stateSignal) {
            stateSignal.set(value);
        } else {
            unsubscribe();
        }
    });

    cleanupRef?.onDestroy(unsubscribe);
    
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