import { describe, expect, it } from 'vitest';

import { setScheduler } from '@slimlib/store';

import { createElement } from '../src/index.ts';

setScheduler(fn => fn());

let counter = 0;
const uniqueTag = base => `${base}-${++counter}`;

const supportsCustomizedBuiltIns = () => {
    const tag = uniqueTag('x-slim-jsx-probe');
    try {
        class ProbeButton extends HTMLButtonElement {}
        customElements.define(tag, ProbeButton, { extends: 'button' });
        return document.createElement('button', { is: tag }) instanceof ProbeButton;
    } catch {
        return false;
    }
};

const itIf = supportsCustomizedBuiltIns() ? it : it.skip;

describe('customized built-in elements (is="...")', () => {
    itIf('upgrades a customized built-in produced by the jsx runtime', () => {
        const tag = uniqueTag('x-slim-jsx-counter');
        class CounterButton extends HTMLButtonElement {}
        customElements.define(tag, CounterButton, { extends: 'button' });

        const element = createElement('button', { is: tag });

        expect(element).toBeInstanceOf(CounterButton);
        expect(element).toBeInstanceOf(HTMLButtonElement);
    });
});
