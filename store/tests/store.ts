import { createStore } from '../src/svelte';

const [state, store] = createStore<number[]>([]);

export function addElement() {
    state.push(1);
}

export const items = {
    subscribe: store
};

