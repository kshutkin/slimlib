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

**v0.1.0-pre.** API is locked, 62 tests passing, 100% branch coverage, benchmarks wired in.

New in v0.1:
- Keyed list reconciliation via [`forEach`](#keyed-lists-foreach) (sub-entry, opt-in).
- Per-boundary dispose for conditional sub-trees (effects, `on:`, `ref` torn down when a function-child re-runs).
- `setOnDispose` is now public for users implementing custom list/conditional helpers.

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

#### Commit timing

`@slimlib/jsx` is **scheduler-agnostic**: it never calls `flushEffects()` internally. Reactive bindings are scheduled by `@slimlib/store`'s scheduler, which defaults to `queueMicrotask`. As a result, `render()` returns with the comment-anchor structure in place but reactive children populate on the next microtask.

For synchronous observation (tests, SSR, or a `connectedCallback` that needs `this.children` immediately) pick one:

```js
import { flushEffects, setScheduler } from '@slimlib/store';

// 1) Drain manually after each commit point:
render(() => <App />, document.body);
flushEffects(); // may need to be called multiple times if effects schedule more effects

// 2) Install a synchronous scheduler globally (signal writes commit inline,
//    at the cost of losing write batching):
setScheduler(fn => fn());
```

The library does not pick for you because the right answer depends on whether you value batched microtask updates (default) or strict synchronous commits.

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

For long reactive lists with stable identity, use [`forEach`](#keyed-lists-foreach) instead — it keys nodes and reuses them on reorder.

## Keyed lists: `forEach`

Long lists with stable identity should use the keyed list helper. It's shipped as a sub-entry so apps that don't need it pay nothing:

```jsx
import { forEach } from '@slimlib/jsx/for-each';
import { signal } from '@slimlib/store';

const items = signal([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);

<ul>
    {forEach(
        () => items(),
        (item) => item.id,
        (item, index) => <li>{() => item().label}</li>,
    )}
</ul>
```

Signature: `forEach<T>(each: () => readonly T[], key: (item, index) => string | number, body: (item: () => T, index: () => number) => Node): DocumentFragment`.

- `each` is a thunk read in the renderer's reactive scope; updates to the underlying signal trigger reconciliation.
- `key` must be unique per row. Identical keys reuse the same DOM node and per-item reactive scope on reorder.
- `body` receives reactive accessors for `item` and `index` — both update in place when the same key moves position or its value changes, without rebuilding DOM.
- Each row gets its own sub-scope, so `on:` listeners, `ref` callbacks, and `effect()` calls inside a row are disposed when the row is removed (or when the parent tree is disposed).
- Returns a `DocumentFragment` — drop it anywhere JSX accepts a child (including inside a function-child return).

Bundle cost: **610 B gzip** (sub-entry, separate from core).

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

The element body is populated on the next microtask after `render()` returns (see [Commit timing](#commit-timing)). This is fine for the usual case of a freshly-attached element with no consumer reading its children synchronously; install a sync scheduler if your tests need to inspect children inside the same microtask as `connectedCallback`.

## Benchmarks

Real-DOM benchmarks (Chromium via Playwright with `--expose-gc`, M1 Mac, mitata `.gc('inner')` to isolate GC pauses; median of 3 runs; lower is better):

| Scenario | @slimlib/jsx | lit-html | voby | preact | solid-js |
|---|---:|---:|---:|---:|---:|
| create-1000 (1000 children mount) | **0.60 ms** | 0.06 ms | 1.13 ms | 0.70 ms | 0.74 ms |
| update-1000 (reactive text update) | 0.53 ms | 0.14 ms | 0.50 ms | 0.35 ms | 0.57 ms |
| custom-element-mount (100×) | 0.33 ms | 0.30 ms | 0.35 ms | 0.31 ms | 0.36 ms |
| deep-tree (4096 leaves) | **2.49 ms** | 0.48 ms | 6.17 ms | 4.42 ms | 5.46 ms |
| deep-tree-update (reactive label) | 1.72 ms | 0.87 ms | 1.27 ms | 2.30 ms | 0.98 ms |
| swap-rows (keyed) | **0.70 ms** | 0.21 ms | 0.27 ms | 0.39 ms | 0.32 ms |
| shuffle-1000 (keyed) | **0.85 ms** | 0.83 ms | 0.59 ms | 2.27 ms | 0.57 ms |

Keyed scenarios use `forEach` from `@slimlib/jsx/for-each`. The bench harness drives `@slimlib/jsx` with the default microtask scheduler and explicitly calls `flushEffects()` after each signal write to make commit cost visible in the timed window. Reproduce: `pnpm bench:browser` (writes `results-browser.csv`).

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

- **One scope per `render()` call, with sub-scopes per dynamic boundary.** Components do NOT create their own scopes. Every function-child boundary (`{() => ...}`) and every `forEach` row gets a sub-scope that is disposed and replaced on re-run, so `on:` listeners, `ref` callbacks, and inner `effect()` calls don't leak when conditionals flip or list rows are removed.
- **Scheduler-agnostic commit.** `@slimlib/jsx` never calls `flushEffects()` internally — that would silently force *every* pending `@slimlib/store` effect (including ones from other packages) to run on the renderer's terms. Instead, the renderer enqueues effects via the store's scheduler and trusts the host to decide commit timing. See [Commit timing](#commit-timing) for the two supported modes.
- **DocumentFragment only when needed.** When a component returns a single Node, the renderer inserts it directly. Fragment wrapping is reserved for primitives, arrays, and function-children — keeping deep-tree mounts cheap.
- **Keyed reconciliation lives in a sub-entry.** `forEach` is opt-in via `@slimlib/jsx/for-each` so apps that don't need keyed lists don't pay for the diff algorithm. A reverse-walk reorder using `nextSibling` checks avoids the LIS step; reconcile is wrapped in `untracked()` to prevent the outer effect from re-subscribing on item writes.
- **Prototype-setter cache.** First touch of each `(tagName, propName)` pair walks the prototype chain; result cached for the lifetime of the program. Same heuristic as vanjs.

## License

MIT
