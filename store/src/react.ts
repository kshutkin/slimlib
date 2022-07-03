import { useState, useEffect } from 'react';
import { createStoreFactory, Store } from './core';

export const createStore = createStoreFactory(false);

export const useStore = <T>(store: Store<T>) => {
    const [, setState] = useState<object>();
    
    useEffect(() => {
        return store(() => setState({}));
    }, [store]);
    
    return store();
};
