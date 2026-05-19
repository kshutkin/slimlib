import { render } from '@slimlib/jsx';
import { forEach } from '@slimlib/jsx/for-each';
import { computed, signal } from '@slimlib/store';

// Counter — signals + on:click + reactive text
const Counter = () => {
    const count = signal(0);
    return (
        <div class="row">
            <button on:click={() => count.set(count() - 1)}>−</button>
            <output>{count}</output>
            <button on:click={() => count.set(count() + 1)}>+</button>
            <button on:click={() => count.set(0)}>reset</button>
        </div>
    );
};

// Conditional render — proves sub-scope cleanup
// (on:click handlers and effects inside each branch are disposed when the branch swaps)
const Toggle = () => {
    const open = signal(false);
    return (
        <div>
            <button on:click={() => open.set(!open())}>
                {() => (open() ? 'Hide details' : 'Show details')}
            </button>
            <div>
                {() =>
                    open() ? (
                        <p>
                            Hidden text. Open the devtools and watch the DOM swap — the previous branch's effects,
                            <code> on:</code>-listeners and <code>ref</code> callbacks are torn down before this one mounts.
                        </p>
                    ) : null
                }
            </div>
        </div>
    );
};

// Reactive text input — signal driven from input event
const Greeter = () => {
    const name = signal('world');
    const upper = computed(() => name().toUpperCase());
    return (
        <div class="row">
            <input
                type="text"
                value={name}
                on:input={e => name.set(e.currentTarget.value)}
            />
            <span>
                Hello, <strong>{name}</strong>! ({upper})
            </span>
        </div>
    );
};

// Keyed list via forEach — add / remove / toggle / shuffle
let nextId = 4;
const TodoList = () => {
    const items = signal([
        { id: 1, text: 'Write tests', done: true },
        { id: 2, text: 'Ship forEach', done: true },
        { id: 3, text: 'Build playground', done: false },
    ]);
    const draft = signal('');
    const add = () => {
        const text = draft().trim();
        if (!text) return;
        items.set([...items(), { id: nextId++, text, done: false }]);
        draft.set('');
    };
    const toggle = id => items.set(items().map(it => (it.id === id ? { ...it, done: !it.done } : it)));
    const remove = id => items.set(items().filter(it => it.id !== id));
    const shuffle = () =>
        items.set(
            items()
                .map(it => [Math.random(), it])
                .sort((a, b) => a[0] - b[0])
                .map(([, it]) => it),
        );
    return (
        <div>
            <div class="row">
                <input
                    type="text"
                    value={draft}
                    on:input={e => draft.set(e.currentTarget.value)}
                    on:keydown={e => e.key === 'Enter' && add()}
                    placeholder="New item…"
                />
                <button on:click={add}>add</button>
                <button on:click={shuffle}>shuffle</button>
            </div>
            <ul class="todo">
                {forEach(
                    items,
                    it => it.id,
                    it => (
                        <li class={() => (it().done ? 'done' : '')}>
                            <input
                                type="checkbox"
                                checked={() => it().done}
                                on:change={() => toggle(it().id)}
                            />
                            <span>{() => it().text}</span>
                            <button on:click={() => remove(it().id)}>×</button>
                        </li>
                    ),
                )}
            </ul>
            <p>
                <small>
                    {() => items().filter(it => !it.done).length} open / {() => items().length} total
                </small>
            </p>
        </div>
    );
};

const App = () => (
    <>
        <h1>@slimlib/jsx playground</h1>
        <p>
            Edit <code>main.jsx</code> and refresh — esbuild rebuilds on request. JSX is compiled with{' '}
            <code>jsxImportSource: "@slimlib/jsx"</code>.
        </p>
        <section class="demo">
            <h2>Counter (signal + on:click)</h2>
            <Counter />
        </section>
        <section class="demo">
            <h2>Conditional (sub-scope cleanup)</h2>
            <Toggle />
        </section>
        <section class="demo">
            <h2>Reactive text + computed</h2>
            <Greeter />
        </section>
        <section class="demo">
            <h2>Keyed list (forEach)</h2>
            <TodoList />
        </section>
    </>
);

render(() => <App />, document.getElementById('app'));
