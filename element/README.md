# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```jsx
import { defineElement, extend } from '@slimlib/element';

// Declare attributes the browser should observe; declare reactive props inside.
defineElement('my-counter', ['count'], (host) => {
    const s = extend(host, { count: 0, hovering: false });
    return <button
        on:mouseenter={() => s.hovering = true}
        on:mouseleave={() => s.hovering = false}
        on:click={() => s.count++}
    >
        {() => `${s.count}${s.hovering ? ' 👀' : ''}`}
    </button>;
});

// No observed attributes — render-only element.
defineElement('my-banner', (host) => <div>hello</div>);
```

## Model

`defineElement(tag, attrs?, render)` registers a light-DOM custom element. The browser observes the names in `attrs`; `attributeChangedCallback` writes the raw string to `this[name]`, which the `extend`-installed accessor forwards into the reactive store.

`extend(host, props)` creates a `state()` proxy seeded from `props`, installs `host.<key>` accessors that proxy to it, and returns the proxy. Render code uses the proxy directly (`s.count++`); external code (HTML attributes, parent JS) goes through `host.count`. Both land in the same store.

Lazy-upgrade: if a key already exists as an own property on the host (parser-set attribute fired before connect, or `el.count = 5` before `customElements.define`), `extend` adopts the value into the store and replaces it with the accessor.

Shadow DOM, typed attribute coercion, and reflection are not in this tier — see `IDEAS.md` (proposals #4 and #5 Tier 2).
