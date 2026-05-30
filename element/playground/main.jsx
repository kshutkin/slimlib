import { attributes, boolAttr, defineElement, numberAttr, props, stringAttr } from '@slimlib/element';
import { setScheduler } from '@slimlib/store';

// Microtask scheduler so reflection is async-realistic (like the jsx playground).
setScheduler(queueMicrotask);

// A custom element demonstrating attribute reflection + coercion:
//  - count: Number, reflected  (+/- buttons mutate the reactive prop)
//  - open:  Boolean, reflected (toggle button)
//  - label: String, observed but NOT reflected
defineElement(
    'reflect-demo',
    [
        attributes({
            count: numberAttr,
            open: boolAttr,
            label: [stringAttr[0]],
        }),
    ],
    host => {
        const state = props({ count: 0, open: false, label: 'hello' });
        // Expose the reactive proxy so the page-level buttons can mutate it.
        host._state = state;
        return (
            <div class='row'>
                <button type='button' on:click={() => state.count--}>
                    −
                </button>
                <output>{() => state.count}</output>
                <button type='button' on:click={() => state.count++}>
                    +
                </button>
                <button type='button' on:click={() => (state.open = !state.open)}>
                    {() => (state.open ? 'open' : 'closed')}
                </button>
                <span>
                    label: <strong>{() => state.label}</strong>
                </span>
            </div>
        );
    }
);

const app = document.getElementById('app');

const element = document.createElement('reflect-demo');

const panel = document.createElement('div');
panel.className = 'demo';
panel.innerHTML = `
    <h2>prop → attribute (watch devtools)</h2>
    <p class="hint">The element below mutates its reactive props on click; the reflected attributes update in the DOM.</p>
`;
panel.appendChild(element);

const attrPanel = document.createElement('div');
attrPanel.className = 'demo';
attrPanel.innerHTML = '<h2>attribute → prop (coercion)</h2>';

const row = document.createElement('div');
row.className = 'row';

const mkButton = (text, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
};

row.append(
    mkButton('setAttribute count="42"', () => element.setAttribute('count', '42')),
    mkButton('removeAttribute count', () => element.removeAttribute('count')),
    mkButton('setAttribute open', () => element.setAttribute('open', '')),
    mkButton('removeAttribute open', () => element.removeAttribute('open')),
    mkButton('setAttribute label="world"', () => element.setAttribute('label', 'world'))
);

attrPanel.append(row);

app.append(panel, attrPanel);
