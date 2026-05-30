# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```jsx
import { attributes, defineElement, props } from '@slimlib/element';

// Observe attributes via the attributes middleware;
// declare reactive props inside the render callback.
defineElement('my-counter', [attributes({ count: {} })], (host) => {
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

`defineElement(tag, middleware?, render)` registers an autonomous light-DOM custom element. `defineBuiltinElement(tag, extendElement, middleware?, render)` registers a customized built-in. `createCustomElement(middleware?, render, Base?)` is the low-level builder for custom registries or manual `customElements.define`; it returns an unregistered class. Class-time configuration (observed attributes, form association, disabled features, ElementInternals, niche lifecycle hooks) is composed from a `Middleware[]` array of functions with shape `(Base) => SubClass`. The wrapper applies them outward over the slim core (which owns `connectedCallback` / `disconnectedCallback`).

`attributes({ count: {} })` sets `static observedAttributes` so the browser fires `attributeChangedCallback`, and the middleware itself owns that callback: it coerces the incoming value and writes it to `this[name]`, where the `props`-installed accessor picks it up.

`props(initial)` is called inside the render callback. It creates a `state()` proxy seeded from `initial`, installs `host.<key>` accessors that proxy to it, and returns the proxy. Render code uses the proxy directly (`s.count++`); external code (HTML attributes, parent JS) goes through `host.count`. Both land in the same store.

Lazy-upgrade: if a key already exists as an own property on the host (parser-set attribute fired before connect, or `el.count = 5` before `customElements.define`), `props` adopts the value into the store and replaces it with the accessor.

Lifecycle: the render callback runs once, on the first `connectedCallback`. Disconnect schedules a microtask-deferred teardown so synchronous remount (e.g. `appendChild` to a different parent within the same task) preserves the rendered DOM, effects, and reactive state. If the element stays detached past that microtask, the jsx scope is disposed.

## Typed attributes and reflection

`attributes(config)` accepts a descriptor map:

```jsx
defineElement('my-counter', [
    attributes({
        count: { type: Number, reflect: true },
        open:  { type: Boolean, reflect: true },
        label: {}, // observe + string passthrough, no reflection
    }),
], (host) => {
    const s = props({ count: 0, open: false, label: '' });
    // ...
});
```

Descriptor fields:

- `type` — coercion applied to the inbound attribute value (`string | null`):
  - `Number` → `Number(raw)`
  - `Boolean` → presence/absence (`raw !== null`); any value (even `"false"`) is `true`
  - `String` or omitted → string passthrough
  - a custom `(raw: string | null) => unknown` function → called as `type(raw)`
  - removing an attribute delivers `null` to the prop (Boolean delivers `false`). The
    middleware does not restore a default; declare your own default via `props()`.
- `reflect` — when `true`, JS writes to the prop are mirrored back to the DOM attribute.
  Numbers/strings stringify via `String(value)`; Booleans add/remove the attribute;
  `null`/`undefined` removes it. Redundant writes are skipped: with the built-in
  `Number`/`Boolean`/`String` types (which are round-trip stable) the
  reflect → `attributeChangedCallback` → prop loop self-terminates. A **custom** `type`
  used together with `reflect: true` **must** be round-trip stable — `type(String(value))`
  must deep-equal `value` — otherwise each reflection produces a new value and reflection
  can loop indefinitely. (In DEV a runaway reflect loop is detected and `console.warn`s.)

Reflection is driven by a `@slimlib/store` effect that reads `host[name]`, so a reflected
attribute **must** be declared via `props()` (otherwise the read is not reactive). In DEV a
reflected key that was not declared via `props()` logs a `console.warn`.

See `README.md` for usage and `IDEAS.md` for the roadmap.

## Advanced: bring your own registry

`createCustomElement(middleware?, render, Base?)` returns an **unregistered** `CustomElementConstructor` — it never calls `customElements.define` itself. That lets you register the class wherever you want: the global registry, a custom subclass, or a scoped `CustomElementRegistry`.

```js
import { createCustomElement, attributes } from '@slimlib/element';

const MyEl = createCustomElement([attributes({ count: {} })], (host) => {
    /* ... */
});

// Register wherever you like:
const registry = new CustomElementRegistry(); // scoped registry
registry.define('my-el', MyEl);
// or customElements.define('my-el', MyEl) for the global registry.
```

Scoped custom element registries are a newer platform feature (Chrome 146+, Safari 26+; not yet in Firefox), so feature-detect before relying on them.


