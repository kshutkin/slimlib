# @slimlib/jsx

Tiny JSX renderer (~5.8KiB minified, ~2.4 KiB gzip together with reactive primitives) with reactive primitives. Real DOM nodes, no virtual DOM.

```jsx
import { signal } from "@slimlib/store";
import { render } from "@slimlib/jsx";

const Counter = () => {
  const count = signal(0);
  return (
    <button on:click={() => count.set(count() + 1)}>Count: {count}</button>
  );
};

render(() => <Counter />, document.body);
```

[Changelog](./CHANGELOG.md)

## Installation

```bash
npm install @slimlib/jsx
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
  console.log("runs once at mount");
  return <h1>Hello, {props.name}!</h1>;
}
```

Updates flow exclusively through reactive primitives from `@slimlib/store`:

- `signal(value)` — readable + `.set()` writable value.
- `computed(fn)` — derived value.
- `effect(fn)` — side-effect that re-runs on dependency change.

When you put a **function** in a JSX expression, the renderer wraps it in an `effect()` automatically. Signals from `@slimlib/store` are themselves callable functions, so you pass them in directly — no wrapper closure needed for a single-signal read:

```jsx
const name = signal("World");

<div>
  Hello, {name} {/* reactive text */}
  <span class={() => (active() ? "on" : "off")} /> {/* reactive attr — derived */}
</div>;

name.set("there"); // text updates
```

Same model as SolidJS, but without the JSX-compiler magic. The wrapper form `{() => sig()}` is only needed when you combine multiple signals, do a ternary, or compute a derived value — anything beyond a single signal read. For per-property reactivity inside `forEach`, see [Gotchas](#gotchas).

## API

### `render(factory, container) => disposeFn`

Mounts a JSX tree into a DOM container.

- `factory` **must be a function** that returns JSX. This is required so reactive bindings are created inside the render scope and torn down on dispose.
- Returns a function that disposes all effects, event listeners, and refs in the tree, then removes the DOM range inserted by this render call.

```jsx
const dispose = render(() => <App />, document.body);
// ...later
dispose();
```

#### Commit timing

`@slimlib/jsx` wires reactive bindings (attribute effects, function-child effects, `forEach` reconciler) as **eager** effects internally — they run synchronously during `render()` so the first paint is fully populated before `render()` returns. There is no microtask gap between mount and first render; tests and SSR-style code can read the DOM immediately.

```jsx
const dispose = render(() => <App />, document.body);
// document.body already contains the fully rendered tree.
```

Subsequent re-runs (triggered by signal/state writes) still go through `@slimlib/store`'s scheduler, which defaults to `queueMicrotask`. Multiple synchronous writes coalesce into one re-run as usual. To change that timing you have two options:

```js
import { flushEffects, setScheduler } from "@slimlib/store";

// 1) Drive scheduling manually (drain after each write batch):
setScheduler((fn) => fn()); // sync — every write commits inline
// or
setScheduler(myQueue); // your own — call flushEffects() when ready

// 2) Stay on microtask scheduling, but force-drain at known sync points:
write1();
write2();
flushEffects(); // commit both
```

##### Internal use of `EffectOptions.EAGER`

Internally, `@slimlib/jsx` calls `effect(fn, EffectOptions.EAGER)` for the bindings it sets up. This has three consequences worth knowing:

- **First-run errors propagate to `render()`.** A function-child that throws, or a `forEach` body that returns a non-Node, will throw synchronously from `render()` — you get a real stack trace at the call site and can wrap in `try/catch`. With the default `DEFERRED` mode those errors would be swallowed and logged by the scheduler's flush loop.
- **`activeScope` is the render scope during initial wiring.** Function-child effects and per-item `forEach` scopes are parented correctly without any internal `activeScope` capture.
- **No microtask gap.** Calls that observe the DOM right after `render()` (e.g. `connectedCallback`, integration tests, snapshot serializers) see the final tree without needing `flushEffects()` or `await Promise.resolve()`.

User-land `effect()` calls inside your components remain deferred by default — only the renderer's internal wiring is eager.

### `createElement(type, props, ...children)`

The hyperscript factory the JSX runtime calls. You can use it directly:

```js
import { createElement as h } from "@slimlib/jsx";
const node = h("div", { class: "box" }, "hello");
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
<div ref={(el) => (ref = el)}>...</div>;
```

Called with the element on mount and with `null` on dispose.

### Reactive values

A function in any prop becomes an `effect`:

```jsx
<div
  class={() => (active() ? "on" : "off")}
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
  {items().map((item) => (
    <li>{item}</li>
  ))}{" "}
  {/* static snapshot */}
  {() => items().map((item) => <li>{item}</li>)} {/* reactive (no keying!) */}
</ul>
```

For long reactive lists with stable identity, use [`forEach`](#keyed-lists-foreach) instead — it keys nodes and reuses them on reorder.

## Keyed lists: `forEach`

Long lists with stable identity should use the keyed list helper. It's shipped as a sub-entry so apps that don't need it pay nothing:

```jsx
import { forEach } from "@slimlib/jsx/for-each";
import { signal } from "@slimlib/store";

const items = signal([
  { id: 1, label: "A" },
  { id: 2, label: "B" },
]);

<ul>
  {forEach(
    items,
    (item) => item.id,
    (item, index) => (
      <li>{() => item().label}</li>
    )
  )}
</ul>;
```

`each` accepts a bare signal directly (it's a function). Inside `body`, `item()` returns the **whole entry** — so reading a single property reactively still needs the wrapper form `{() => item().prop}`.

Signature: `forEach<T>(each: () => readonly T[], key: (item, index) => string | number, body: (item: () => T, index: () => number) => Node): DocumentFragment`.

- `each` is a thunk read in the renderer's reactive scope; updates to the underlying signal trigger reconciliation.
- `key` must be unique per row. Identical keys reuse the same DOM node and per-item reactive scope on reorder.
- `body` receives reactive accessors for `item` and `index` — both update in place when the same key moves position or its value changes, without rebuilding DOM.
- Each row gets its own sub-scope, so `on:` listeners, `ref` callbacks, and `effect()` calls inside a row are disposed when the row is removed (or when the parent tree is disposed).
- Returns a `DocumentFragment` — drop it anywhere JSX accepts a child (including inside a function-child return).

Bundle cost: **610 B gzip** (sub-entry, separate from core).

## Context

Context is opt-in via a sub-entry, so apps that do not import it do not pay for the feature:

```jsx
import { createContext, getContext, provideContext } from "@slimlib/jsx/context";
import { signal } from "@slimlib/store";

const ThemeContext = createContext(signal("light"));

const Label = () => {
  const theme = getContext(ThemeContext);
  return <span class={() => `theme-${theme()}`}>Themed label</span>;
};

const App = () => {
  const theme = signal("dark");
  return provideContext(ThemeContext, theme, () => <Label />);
};
```

API:

- `createContext(defaultValue?)` creates a typed context token.
- `getContext(context)` returns the nearest provided value, or the default value.
- `provideContext(context, value, factory)` runs `factory` with `value` available to everything built inside it.

`provideContext` takes a factory instead of JSX children because JSX children are created before their parent component runs. Keep context reads in setup code, then close over the returned value inside reactive bindings:

```jsx
const Child = () => {
  const theme = getContext(ThemeContext);
  return <div class={() => theme()} />;
};
```

## SVG (and other namespaces)

JSX is evaluated bottom-up: children are constructed before their parent, so the renderer can't infer a namespace from the surrounding `<svg>` tag. Use the `svg()` factory to enter the SVG namespace for a sub-tree:

```jsx
import { svg, html } from "@slimlib/jsx";

const Icon = () =>
  svg(() => (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
    </svg>
  ));
```

Every element created inside the `svg()` callback uses `createElementNS('http://www.w3.org/2000/svg', …)`. Nesting works as expected — call `html()` to switch back inside `<foreignObject>`:

```jsx
svg(() => (
  <svg>
    <foreignObject x="0" y="0" width="100" height="50">
      {html(() => (
        <div>HTML inside SVG</div>
      ))}
    </foreignObject>
  </svg>
));
```

The factory only affects elements created during the callback; once it returns, the previous namespace is restored. Generic signature: `svg<T>(fn: () => T): T`, same for `html`.

## Gotchas

**`on:event={sig}` and `ref={sig}` are NOT reactive.** Both paths bail out before the reactive-function check: the renderer always treats `on:*` values as event listeners and `ref` values as callbacks. Pass a literal handler/ref function — not a signal:

```jsx
{
  /* WRONG — sig becomes the click listener and fires with an Event arg */
}
<button on:click={mySignal}>...</button>;

{
  /* WRONG — sig is invoked once with the element, never re-invoked */
}
<div ref={mySignal}>...</div>;

{
  /* OK */
}
<button on:click={() => mySignal.set(mySignal() + 1)}>...</button>;
```

**`forEach` body: `item()` is the whole entry.** Reading a single property is a derived value, so it needs the wrapper form:

```jsx
{
  forEach(
    items,
    (it) => it.id,
    (item) => (
      <li class={() => (item().done ? "done" : "")}>{() => item().text}</li>
    )
  );
}
```

**Reuse the closure when binding multiple slots to the same signal.** `{sig}` allocates nothing extra at the call site, but if you write `{() => sig()}` repeatedly each instance is its own closure. Hoist or just pass `sig` directly.

## Design Notes

- **One scope per `render()` call, with sub-scopes per dynamic boundary.** Components do NOT create their own scopes. Every function-child boundary (`{() => ...}`) and every `forEach` row gets a sub-scope that is disposed and replaced on re-run, so `on:` listeners, `ref` callbacks, and inner `effect()` calls don't leak when conditionals flip or list rows are removed.
- **Scheduler-agnostic commit.** `@slimlib/jsx` never calls `flushEffects()` internally — that would silently force _every_ pending `@slimlib/store` effect (including ones from other packages) to run on the renderer's terms. Instead, the renderer enqueues effects via the store's scheduler and trusts the host to decide commit timing. See [Commit timing](#commit-timing) for the two supported modes.
- **DocumentFragment only when needed.** When a component returns a single Node, the renderer inserts it directly. Fragment wrapping is reserved for primitives, arrays, and function-children — keeping deep-tree mounts cheap.
- **Keyed reconciliation lives in a sub-entry.** `forEach` is opt-in via `@slimlib/jsx/for-each` so apps that don't need keyed lists don't pay for the diff algorithm. A reverse-walk reorder using `nextSibling` checks avoids the LIS step; reconcile is wrapped in `untracked()` to prevent the outer effect from re-subscribing on item writes.
- **Prototype-setter cache.** First touch of each `(tagName, propName)` pair walks the prototype chain; result cached for the lifetime of the program. Same heuristic as vanjs.

## License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
