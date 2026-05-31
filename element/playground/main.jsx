import { attributes, booleanAttribute, defineElement, numberAttribute, props, stringAttribute } from '@slimlib/element';
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
            count: numberAttribute,
            open: booleanAttribute,
            label: [stringAttribute[0]],
        }),
    ],
    host => {
        const demoState = props({ count: 0, open: false, label: 'hello' });
        // Expose the reactive proxy so the page-level buttons can mutate it.
        host._state = demoState;
        return (
            <div class='row'>
                <button type='button' on:click={() => demoState.count--}>
                    −
                </button>
                <output>{() => demoState.count}</output>
                <button type='button' on:click={() => demoState.count++}>
                    +
                </button>
                <button type='button' on:click={() => (demoState.open = !demoState.open)}>
                    {() => (demoState.open ? 'open' : 'closed')}
                </button>
                <span>
                    label: <strong>{() => demoState.label}</strong>
                </span>
            </div>
        );
    }
);

const appRoot = document.getElementById('app');

const element = document.createElement('reflect-demo');

const panel = document.createElement('div');
panel.className = 'demo';
panel.innerHTML = `
    <h2>prop → attribute (watch devtools)</h2>
    <p class="hint">The element below mutates its reactive props on click; the reflected attributes update in the DOM.</p>
`;
panel.appendChild(element);

const attributePanel = document.createElement('div');
attributePanel.className = 'demo';
attributePanel.innerHTML = '<h2>attribute → prop (coercion)</h2>';

const row = document.createElement('div');
row.className = 'row';

const createButton = (text, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
};

row.append(
    createButton('setAttribute count="42"', () => element.setAttribute('count', '42')),
    createButton('removeAttribute count', () => element.removeAttribute('count')),
    createButton('setAttribute open', () => element.setAttribute('open', '')),
    createButton('removeAttribute open', () => element.removeAttribute('open')),
    createButton('setAttribute label="world"', () => element.setAttribute('label', 'world'))
);

attributePanel.append(row);

appRoot.append(panel, attributePanel);
