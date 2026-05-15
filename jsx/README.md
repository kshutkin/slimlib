# @slimlib/jsx

Tiny JSX renderer (~2.7 KB gzip) with reactive primitives. Real DOM nodes, no virtual DOM, no scheduler.

```jsx
import { signal } from '@slimlib/store';
import { render } from '@slimlib/jsx';

const Counter = () => {
    const count = signal(0);
    return (
        <button on:click={() => count.set(count() + 1)}>
            Count: {() => count()}
        </button>
    );
};

render(() => <Counter />, document.body);
```

[Changelog](./CHANGELOG.md)

## Status

**v0.0.0 — minimum viable.** API is locked, 27 tests passing, benchmarks wired in.

Not yet supported (planned for v0.1):
- Keyed list reconciliation (`<For each key>`).
- Per-boundary dispose for conditional sub-trees.

## Installation

```bash
npm install @slimlib/jsx @slimlib/store
```

Configure tsconfig (or your bundler) to use the automatic JSX runtime:

```jsonc
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "@slimlib/jsx"
    }
}
```

## Mental Model

**Components run exactly once.** A component is just a function that builds DOM and wires up reactive bindings. There is no re-render, no virtual DOM, no diff.

```jsx
function Greeting(props) {
    console.log('runs once at mount');
    return <h1>Hello, {props.name}!</h1>;
}
```

Updates flow exclusively through reactive primitives from `@slimlib/store`:

- `signal(value)` — readable + `.set()` writable value.
- `computed(fn)` — derived value.
- `effect(fn)` — side-effect that re-runs on dependency change.

When you put a **function** in a JSX expression, the renderer wraps it in an `effect()` automatically:

```jsx
const name = signal('World');

<div>
    Hello, {() => name()}                            {/* reactive text */}
    <span class={() => active() ? 'on' : 'off'} />   {/* reactive attr */}
</div>

name.set('there');                       // text updates
```

Same model as SolidJS, but without the JSX-compiler magic — you explicitly write `{() => signal()}` rather than `{signal()}`.

## API

### `render(factory, container) => disposeFn`

Mounts a JSX tree into a DOM container.

- `factory` **must be a function** that returns JSX. This is required so reactive bindings are created inside the render scope and torn down on dispose.
- Returns a function that removes the inserted nodes and disposes all effects, event listeners, and refs in the tree.

```jsx
const dispose = render(() => <App />, document.body);
// ...later
dispose();
```

### `createElement(type, props, ...children)`

The hyperscript factory the JSX runtime calls. You can use it directly:

```js
import { createElement as h } from '@slimlib/jsx';
const node = h('div', { class: 'box' }, 'hello');
```

- `type`: string tag name OR a function component.
- `props`: object or `null`.
- `children`: variadic.

### `Fragment`

A no-op component that returns its children. Use with JSX `<>...</>`:

```jsx
<>
    <li>one</li>
    <li>two</li>
</>
```

## Props, attributes, events, refs

### Plain props
The renderer uses a **prototype-setter heuristic**: walks the element's prototype chain for a setter on the key. If found → property assignment (`el.value = ...`). Otherwise → `setAttribute`. Cached per `(tagName, propName)` pair.

```jsx
<input value="hi" />        {/* property — types preserved */}
<div data-id="42" />         {/* attribute — no setter on Element.prototype */}
<x-custom config={obj} />    {/* property — custom element exposes setter */}
```

### Explicit `prop:` / `attr:` prefixes
Override the heuristic:

```jsx
<input attr:value="initial" />   {/* force HTML attribute */}
<my-el prop:state={obj} />        {/* force JS property */}
```

### Events: `on:event`

```jsx
<button on:click={() => console.log('clicked')}>OK</button>
<input on:input={e => name.set(e.currentTarget.value)} />
```

Listeners are cleaned up automatically when the tree is disposed.

### Refs

```jsx
let ref;
<div ref={(el) => (ref = el)}>...</div>
```

Called with the element on mount and with `null` on dispose.

### Reactive values

A function in any prop becomes an `effect`:

```jsx
<div
    class={() => active() ? 'on' : 'off'}
    style={() => `color: ${color()}`}
/>
```

## Children

- **Primitives** (string, number, boolean, null, undefined) — `null`, `undefined`, `false`, `true` are skipped. Others become text nodes.
- **Nodes** — inserted directly.
- **Arrays** — recursively appended.
- **Functions** — wrapped in `effect()` with comment-anchor boundaries; re-runs replace the sub-range.

```jsx
<ul>
    {items().map(item => <li>{item}</li>)}        {/* static snapshot */}
    {() => items().map(item => <li>{item}</li>)}  {/* reactive (no keying!) */}
</ul>
```

## Web Components

Define a custom element with `render()` in `connectedCallback`:

```jsx
class XCounter extends HTMLElement {
    connectedCallback() {
        const count = signal(0);
        this._dispose = render(
            () => (
                <button on:click={() => count.set(count() + 1)}>
                    Count: {() => count()}
                </button>
            ),
            this,
        );
    }
    disconnectedCallback() {
        this._dispose?.();
    }
}
customElements.define('x-counter', XCounter);
```

Custom element properties are detected by the prototype-setter heuristic — pass typed values straight through JSX.

## Benchmarks

Real-DOM benchmarks (Chromium via Playwright with `--expose-gc`, M1 Mac, mitata `.gc('inner')` to isolate GC pauses; lower is better):

| Scenario | @slimlib/jsx | lit-html | voby | preact | solid-js |
|---|---:|---:|---:|---:|---:|
| create-1000 (1000 children mount) | **0.53 ms** | 0.06 ms | 1.15 ms | 0.69 ms | 0.75 ms |
| update-1000 (reactive text update) | 0.46 ms | 0.16 ms | 0.47 ms | 0.30 ms | 0.60 ms |
| custom-element-mount (100×) | 0.31 ms | 0.29 ms | 0.36 ms | 0.31 ms | 0.36 ms |
| deep-tree (4096 leaves) | **2.44 ms** | 0.54 ms | 6.43 ms | 4.48 ms | 5.52 ms |
| deep-tree-update (reactive label) | 1.39 ms | 0.88 ms | 1.69 ms | 2.48 ms | 1.01 ms |
| swap-rows (keyed) | — | 0.14 ms | 0.27 ms | 0.32 ms | 0.30 ms |
| shuffle-1000 (keyed) | — | 0.90 ms | 0.58 ms | 2.20 ms | 0.58 ms |

Keyed scenarios require v0.1. Reproduce: `pnpm bench:browser` (writes `results-browser.csv`).

### Bundle size (esbuild minified, gzipped)

| Library | Min | **Gzip** | Brotli |
|---|---:|---:|---:|
| vanjs-core | 2.29 KB | **1.13 KB** | 1.04 KB |
| **@slimlib/jsx** | 5.87 KB | **2.70 KB** | 2.40 KB |
| @slimlib/jsx + store | 6.71 KB | **3.06 KB** | 2.73 KB |
| lit-html | 6.99 KB | 3.10 KB | 2.81 KB |
| snabbdom | 8.85 KB | 3.40 KB | 3.06 KB |
| preact | 10.13 KB | 4.32 KB | 3.95 KB |
| solid-js | 20.43 KB | 7.93 KB | 7.20 KB |
| mithril | 25.88 KB | 9.80 KB | 8.77 KB |
| voby | 29.92 KB | 11.14 KB | 10.09 KB |

`@slimlib/jsx` + full reactive system fits in **3.06 KB gzip** — smaller than lit-html alone. Reproduce: `pnpm size`.

## Design Notes

- **One scope per `render()` call.** Components do NOT create per-component scopes. All effects/cleanups go to the single render-level scope, torn down by `dispose()`. Keeps mount cost minimal but means individual subtrees can't be disposed independently (v0.1 plan).
- **DocumentFragment only when needed.** When a component returns a single Node, the renderer inserts it directly. Fragment wrapping is reserved for primitives, arrays, and function-children — keeping deep-tree mounts cheap.
- **No keyed reconciliation in v0.** Re-rendering an array of nodes from a thunk replaces the whole sub-range. For long lists with stable identity, wait for `<For>` in v0.1.
- **Prototype-setter cache.** First touch of each `(tagName, propName)` pair walks the prototype chain; result cached for the lifetime of the program. Same heuristic as vanjs.

## License

MIT
