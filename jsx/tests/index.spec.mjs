// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import { flushEffects, setScheduler, signal } from '@slimlib/store';

import { createElement, Fragment, render } from '../src/index.js';
import { jsx, jsxDEV, jsxs, Fragment as RuntimeFragment } from '../src/jsx-runtime.js';

// JSX itself does not schedule — it relies entirely on @slimlib/store's scheduler.
// Install a synchronous scheduler so effects run on creation/write inline; this
// is what makes the existing assertion patterns work without explicit flushes.
setScheduler(fn => fn());

let mounted = [];
afterEach(() => {
    for (const d of mounted) d();
    mounted = [];
    document.body.innerHTML = '';
});

const mount = factory => {
    const dispose = render(factory, document.body);
    mounted.push(dispose);
    return dispose;
};

describe('@slimlib/jsx public surface', () => {
    it('exports the public API', () => {
        expect(createElement).toBeTypeOf('function');
        expect(render).toBeTypeOf('function');
        expect(Fragment).toBeTypeOf('function');
    });

    it('exposes the jsx-runtime', () => {
        expect(jsx).toBeTypeOf('function');
        expect(jsxs).toBeTypeOf('function');
        expect(jsxDEV).toBeTypeOf('function');
        expect(RuntimeFragment).toBe(Fragment);
    });
});

describe('createElement — static rendering', () => {
    it('creates an element with text child', () => {
        mount(() => createElement('div', null, 'hello'));
        expect(document.body.innerHTML).toBe('<div>hello</div>');
    });

    it('renders nested elements', () => {
        mount(() => createElement('div', null, createElement('span', null, 'a'), createElement('b', null, 'b')));
        expect(document.body.innerHTML).toBe('<div><span>a</span><b>b</b></div>');
    });

    it('flattens arrays of children', () => {
        mount(() => createElement('ul', null, [createElement('li', null, '1'), createElement('li', null, '2')]));
        expect(document.body.innerHTML).toBe('<ul><li>1</li><li>2</li></ul>');
    });

    it('skips null/undefined/boolean children', () => {
        mount(() => createElement('div', null, 'a', null, undefined, true, false, 'b'));
        expect(document.body.innerHTML).toBe('<div>ab</div>');
    });

    it('coerces number/bigint to text', () => {
        mount(() => createElement('div', null, 42, ' ', 7n));
        expect(document.body.innerHTML).toBe('<div>42 7</div>');
    });
});

describe('Fragment', () => {
    it('renders its children directly (no wrapper)', () => {
        mount(() => createElement(Fragment, null, createElement('a', null, '1'), createElement('b', null, '2')));
        expect(document.body.innerHTML).toBe('<a>1</a><b>2</b>');
    });

    it('is just a function returning children', () => {
        expect(Fragment({ children: 'x' })).toBe('x');
    });
});

describe('Function components', () => {
    it('calls components with props + children', () => {
        const Greet = props => createElement('p', null, 'hi ', props.name, ' ', props.children);
        mount(() => createElement(Greet, { name: 'world' }, '!'));
        expect(document.body.innerHTML).toBe('<p>hi world !</p>');
    });
});

describe('Prop / attribute / property handling', () => {
    it('uses property setter when one exists on the prototype', () => {
        mount(() => createElement('input', { value: 'abc' }));
        const input = document.querySelector('input');
        expect(input.value).toBe('abc');
    });

    it('falls back to setAttribute when no setter exists', () => {
        mount(() => createElement('div', { 'data-foo': 'bar' }));
        expect(document.querySelector('div').getAttribute('data-foo')).toBe('bar');
    });

    it('handles boolean attributes via IDL setter (disabled)', () => {
        mount(() => createElement('button', { disabled: true }, 'x'));
        const btn = document.querySelector('button');
        expect(btn.disabled).toBe(true);
        expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('removes boolean attribute when set to false', () => {
        mount(() => createElement('button', { disabled: false }, 'x'));
        const btn = document.querySelector('button');
        expect(btn.disabled).toBe(false);
    });

    it('prop:foo forces property assignment', () => {
        mount(() => createElement('div', { 'prop:customThing': 123 }));
        const div = document.querySelector('div');
        expect(div.customThing).toBe(123);
        expect(div.hasAttribute('customThing')).toBe(false);
    });

    it('attr:foo forces setAttribute', () => {
        mount(() => createElement('input', { 'attr:value': 'default' }));
        const input = document.querySelector('input');
        expect(input.getAttribute('value')).toBe('default');
    });

    it('on:event registers an event listener', () => {
        let clicks = 0;
        mount(() => createElement('button', { 'on:click': () => clicks++ }, 'x'));
        const btn = document.querySelector('button');
        btn.click();
        btn.click();
        expect(clicks).toBe(2);
    });

    it('ref callback receives the element', () => {
        let captured = null;
        mount(() => createElement('span', { ref: el => (captured = el) }, 'x'));
        expect(captured).toBe(document.querySelector('span'));
    });

    it('ref callback receives null on dispose', () => {
        let captured;
        const dispose = mount(() => createElement('span', { ref: el => (captured = el) }, 'x'));
        expect(captured).not.toBe(null);
        dispose();
        expect(captured).toBe(null);
    });
});

describe('Reactive props', () => {
    it('function prop value subscribes and updates', () => {
        const cls = signal('a');
        mount(() => createElement('div', { className: () => cls() }));
        const div = document.querySelector('div');
        expect(div.className).toBe('a');
        cls.set('b');
        flushEffects();
        expect(div.className).toBe('b');
    });

    it('disposes prop effect on unmount', () => {
        const cls = signal('a');
        const dispose = mount(() => createElement('div', { className: () => cls() }));
        const div = document.querySelector('div');
        expect(div.className).toBe('a');
        dispose();
        cls.set('b');
        flushEffects();
        expect(div.className).toBe('a');
    });
});

describe('Reactive children', () => {
    it('function child renders and reacts to signal updates', () => {
        const count = signal(0);
        mount(() => createElement('div', null, 'count=', () => count()));
        const div = document.querySelector('div');
        expect(div.textContent).toBe('count=0');
        count.set(1);
        flushEffects();
        expect(div.textContent).toBe('count=1');
        count.set(42);
        flushEffects();
        expect(div.textContent).toBe('count=42');
    });

    it('function child swaps between element types', () => {
        const showA = signal(true);
        mount(() => createElement('div', null, () => (showA() ? createElement('a', null, 'A') : createElement('b', null, 'B'))));
        const div = document.querySelector('div');
        expect(div.innerHTML).toBe('<!----><a>A</a><!---->');
        showA.set(false);
        flushEffects();
        expect(div.innerHTML).toBe('<!----><b>B</b><!---->');
    });

    it('disposes child effect on unmount', () => {
        const count = signal(0);
        const dispose = mount(() => createElement('div', null, () => count()));
        const div = document.querySelector('div');
        expect(div.textContent).toBe('0');
        dispose();
        count.set(99);
        flushEffects();
        expect(div.textContent).toBe('0');
    });
});

describe('jsx-runtime', () => {
    it('jsx() works like createElement', () => {
        const dispose = render(() => jsx('div', { id: 'x', children: 'hi' }), document.body);
        mounted.push(dispose);
        expect(document.body.innerHTML).toBe('<div id="x">hi</div>');
    });

    it('jsxs() handles array children', () => {
        const dispose = render(() => jsxs('ul', { children: [jsx('li', { children: '1' }), jsx('li', { children: '2' })] }), document.body);
        mounted.push(dispose);
        expect(document.body.innerHTML).toBe('<ul><li>1</li><li>2</li></ul>');
    });

    it('jsx() supports Fragment', () => {
        const dispose = render(
            () => jsx(Fragment, { children: [jsx('a', { children: '1' }), jsx('b', { children: '2' })] }),
            document.body
        );
        mounted.push(dispose);
        expect(document.body.innerHTML).toBe('<a>1</a><b>2</b>');
    });
});
