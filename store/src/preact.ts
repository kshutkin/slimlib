import { useState, useEffect } from 'preact/hooks';
import { createStoreFactory, Store } from './core';

export const createStore = createStoreFactory(false);

export const useStore = <T>(store: Store<T>) => {
    const [, setState] = useState<object>();
    
    useEffect(() => {
        return store(() => setState({}));
    }, []);
    
    return store();
};
