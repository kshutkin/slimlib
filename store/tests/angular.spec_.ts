import { Component } from '@angular/core';
import { createStore, toSignal } from '../src/angular';
import { render, screen } from '@testing-library/angular';

const [state, store] = createStore({ count: 0 });

@Component({
    selector: 'counter',
    template: `
        Current Count: {{ state().count }}
    `,
    standalone: true,
})
export class CounterComponent {
    state = toSignal(store);
}

describe('Counter', () => {
    it('should render counter', async () => {
      await render(CounterComponent);
  
      expect(screen.getByText('Current Count: 0')).toBeDefined();
    })
  
    it('should change the counter on state change', async () => {
      await render(CounterComponent);
  
      state.count++;
  
      expect(screen.getByText('Current Count: 1')).toBeDefined();
    })
})