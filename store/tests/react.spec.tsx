/** @jsx createElement */
import { Fragment, createElement } from 'react';
import { render } from 'react-dom';
import { act } from 'react-dom/test-utils';
import { waitFor } from '@testing-library/react';
import { createStore, useStore } from '../src/react';

const [state, store] = createStore<number[]>([]);

function addElement() {
    state.push(1);
}

function Component() {
    const state = useStore(store);

    return <Fragment>{state.map(item => <li key={item}>{item}</li>)}</Fragment>;
}

describe('test react store binding', () => {
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
});
