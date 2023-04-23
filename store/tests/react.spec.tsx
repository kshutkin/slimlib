/** @jsx createElement */
import { Fragment, createElement, useState, useEffect } from 'react';
import { render } from 'react-dom';
import { act } from 'react-dom/test-utils';
import { waitFor } from '@testing-library/react';
import { createStore, useStore } from '../src/react';
import { Store } from '../src/core';

let [state, store] = createStore<number[]>([]);
const [, store2] = createStore<number[]>([2]);

function addElement() {
    state.push(1);
}

function Component() {
    const state = useStore(store);

    return <Fragment>{state.map(item => <li key={item}>{item}</li>)}</Fragment>;
}

function Component2() {
    const [storeIndex, setIndex] = useState(0);
    const state = useStore([store, store2][storeIndex] as Store<number[]>);
    useEffect(() => {
        setIndex(1);
    }, []);

    return <Fragment>{state.map(item => <li key={item}>{item}</li>)}</Fragment>;
}

describe('test react store binding', () => {

    beforeEach(() => {
        [state, store] = createStore<number[]>([]);
    });

    it ('receives correct value', async () => {
        const target = document.createElement('div');
        act(() => {
            render(<Component/>, target);
        });

        addElement();

        await waitFor(() => {
            expect(target.innerHTML).toEqual('<li>1</li>');
        });
    });

    it ('store change (check what is rendered)', async () => {
        const target = document.createElement('div');
        act(() => {
            render(<Component2/>, target);
        });

        await waitFor(() => {
            expect(target.innerHTML).toEqual('<li>2</li>');
        });
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
        act(() => {
            render(<Component2/>, target);
        });

        await waitFor(() => {
            expect(unsubscribe).toBeCalledTimes(1);
        });
    });
});
