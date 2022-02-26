import Test from './Test.svelte';
import { render, waitFor } from '@testing-library/svelte';
import { addElement } from './store';

describe('test svelte store binding', () => {
    it('receives correct value', async () => {
        const { container } = render(Test);

        addElement();

        await waitFor(() => {
            expect(container.innerHTML).toEqual('<div><li>1</li></div>');
        });
    });
});