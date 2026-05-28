# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```jsx
import { defineElement, observedAttributes, props } from '@slimlib/element';

// Observe attributes via the observedAttributes middleware;
// declare reactive props inside the render callback.
defineElement('my-counter', [observedAttributes(['count'])], (host) => {
    const s = props({ count: 0, hovering: false });
    return <button
        on:mouseenter={() => s.hovering = true}
        on:mouseleave={() => s.hovering = false}
        on:click={() => s.count++}
    >
        {() => `${s.count}${s.hovering ? ' 👀' : ''}`}
    </button>;
});

// No middleware — render-only element.
defineElement('my-banner', (host) => <div>hello</div>);
```

## Model

`defineElement(tag, middleware?, render, extendElement?)` registers a light-DOM custom element. Class-time configuration (observed attributes, form association, disabled features, ElementInternals, niche lifecycle hooks) is composed from a `Middleware[]` array of functions with shape `(Base) => SubClass`. The wrapper applies them outward over the slim core (which owns `connectedCallback` / `disconnectedCallback` / `attributeChangedCallback`).

`observedAttributes(['count'])` sets `static observedAttributes` so the browser fires `attributeChangedCallback`. The slim core writes attribute changes to `this[name]`, where the `props`-installed accessor picks them up.

`props(initial)` is called inside the render callback. It creates a `state()` proxy seeded from `initial`, installs `host.<key>` accessors that proxy to it, and returns the proxy. Render code uses the proxy directly (`s.count++`); external code (HTML attributes, parent JS) goes through `host.count`. Both land in the same store.

Lazy-upgrade: if a key already exists as an own property on the host (parser-set attribute fired before connect, or `el.count = 5` before `customElements.define`), `props` adopts the value into the store and replaces it with the accessor.

Lifecycle: the render callback runs once, on the first `connectedCallback`. Disconnect schedules a microtask-deferred teardown so synchronous remount (e.g. `appendChild` to a different parent within the same task) preserves the rendered DOM, effects, and reactive state. If the element stays detached past that microtask, the jsx scope is disposed.

See `IDEAS.md` for the full middleware kit and roadmap (form association, `ElementInternals`, customized built-ins, attribute reflection).

