/** @jsx h */
import { Fragment, h, render } from 'preact';
import { createStore, useStore } from '../src/preact';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve, 50));
}

const [state, store] = createStore<number[]>([]);

function addElement() {
    state.push(1);
}

function Component() {
    const state = useStore(store);

    return <Fragment>{state.map(item => <li>{item}</li>)}</Fragment>;
}

describe('test preact store binding', () => {
    it ('receives correct value', async () => {
        const target = document.createElement('div');
        render(<Component/>, target);

        await flushPromises();

        addElement();

        await flushPromises();

        expect(target.innerHTML).toEqual('<li>1</li>');
    });
});
