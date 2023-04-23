/** @jsx h */
import { Fragment, h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Store } from '../src/core';
import { createStore, useStore } from '../src/preact';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

let [state, store] = createStore<number[]>([]);
const [, store2] = createStore<number[]>([2]);

function addElement() {
    state.push(1);
}

function Component1() {
    const state = useStore(store);

    return <Fragment>{state.map(item => <li>{item}</li>)}</Fragment>;
}

function Component2() {
    const [storeIndex, setIndex] = useState(0);
    const state = useStore([store, store2][storeIndex] as Store<number[]>);
    useEffect(() => {
        setIndex(1);
    }, []);

    return <Fragment>{state.map(item => <li>{item}</li>)}</Fragment>;
}

describe('test preact store binding', () => {
    
    beforeEach(() => {
        [state, store] = createStore<number[]>([]);
    });

    it ('receives correct value', async () => {
        const target = document.createElement('div');
        render(<Component1/>, target);

        await flushPromises();

        addElement();

        await flushPromises();

        expect(target.innerHTML).toEqual('<li>1</li>');
    });

    it ('store change (check what is rendered)', async () => {
        const target = document.createElement('div');
        render(<Component2/>, target);

        await flushPromises();

        expect(target.innerHTML).toEqual('<li>2</li>');
    });

    it ('store change (check that component unsubscribed from previous store)', async () => {
        const target = document.createElement('div');
        const unsubscribe = jest.fn();
        store = jest.fn((cb) => {
            if (cb) {
                return unsubscribe;
            } else {
                return [];
            }
        }) as never as Store<number[]>;
        render(<Component2/>, target);

        await flushPromises();

        expect(unsubscribe).toBeCalledTimes(1);
    });
});
