import { BehaviorSubject } from 'rxjs';
import { Store, createStoreFactory } from './core';

export const createStore = createStoreFactory(false);

export const toObservable = <T>(store: Store<T>) => {
    const state = new BehaviorSubject(store());

    state.subscribe({
        complete: store((value: T) => {
            state.next(value);
        })
    });

    return state.asObservable();
};