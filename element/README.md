# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```jsx
import { attributes, defineElement, numberAttr, props } from '@slimlib/element';

// Observe attributes via the attributes middleware;
// declare reactive props inside the render callback.
defineElement('my-counter', [attributes({ count: numberAttr })], (host) => {
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

`attributes({ count: numberAttr })` sets `static observedAttributes` so the browser fires `attributeChangedCallback`, and the middleware itself owns that callback. Each direction is opt-in: an attribute is only written to `this[name]` when its descriptor provides a `parse` function. With `parse` present the middleware parses the incoming value and writes it to `this[name]`, where the `props`-installed accessor picks it up; with `parse` absent the inbound change is ignored entirely.

`props(initial)` is called inside the render callback. It creates a `state()` proxy seeded from `initial`, installs `host.<key>` accessors that proxy to it, and returns the proxy. Render code uses the proxy directly (`s.count++`); external code (HTML attributes, parent JS) goes through `host.count`. Both land in the same store.

Lazy-upgrade: if a key already exists as an own property on the host (parser-set attribute fired before connect, or `el.count = 5` before `customElements.define`), `props` adopts the value into the store and replaces it with the accessor.

Lifecycle: the render callback runs once, on the first `connectedCallback`. Disconnect schedules a microtask-deferred teardown so synchronous remount (e.g. `appendChild` to a different parent within the same task) preserves the rendered DOM, effects, and reactive state. If the element stays detached past that microtask, the jsx scope is disposed.

## Typed attributes and reflection

`attributes(config)` accepts a map of `[parse?, serialize?]` tuples:

```jsx
import { attributes, numberAttr, boolAttr, stringAttr, defineElement, props } from '@slimlib/element';

defineElement('my-counter', [
    attributes({
        count: numberAttr,         // parse + serialize → observe + reflect
        open:  boolAttr,            // parse + serialize → observe + reflect
        label: [stringAttr[0]],     // parse only → observe-only (no reflection)
        hint:  [],                  // inert: neither observed nor reflected
    }),
], (host) => {
    const s = props({ count: 0, open: false, label: '' });
    // ...
});
```

A descriptor is a positional tuple `[parse?, serialize?]`, with each direction independently opt-in:

- `[]` — **inert**. The attribute is in `observedAttributes`, but inbound changes are not
  written to the prop and prop writes are not reflected.
- `[parse]` — **observe-only**. Inbound attribute changes are parsed into the prop; prop
  writes are not reflected. Use an explicit parse such as `[stringAttr[0]]` for a raw
  passthrough.
- `[undefined, serialize]` — **reflect-only**. Prop writes are mirrored to the attribute,
  but inbound attribute changes are never parsed back into the prop — so it structurally
  cannot loop.
- `[parse, serialize]` — **both**. Observe inbound and reflect outbound.

- `parse: (raw: string | null) => unknown` — converts an inbound attribute value into a
  prop value. **Omitted means the attribute is not observed**: inbound changes are skipped
  and the prop is left untouched. Removing an attribute delivers `null` to `parse`; the
  middleware does not restore a default, declare your own default via `props()`.
- `serialize: (value: unknown) => string | null` — converts a prop value into an attribute
  string, or `null`/`undefined` to remove the attribute. **Presence of `serialize` implies
  reflection**: when it is supplied, JS writes to the prop are mirrored back to the DOM
  attribute. There is no separate `reflect` flag.

Reflection skips redundant writes (only writes when the serialized value differs), so a
round-trip-stable pair settles. When **both** `parse` and `serialize` are present the
`[parse, serialize]` pair **must** be round-trip stable — `serialize(parse(out)) === out` —
otherwise each reflection produces a new attribute string and reflection would loop. In DEV
this is checked deterministically: an unstable pair **throws** an `Error` describing the
failing round-trip, instead of looping. (A reflect-only `[undefined, serialize]` descriptor
cannot loop, since inbound changes are never parsed back, so the check does not apply.)

Exported presets:

- `numberAttr` — `[raw => raw === null ? null : Number(raw), value => value == null ? null : String(value)]`
- `boolAttr` — `[raw => raw !== null, value => value ? '' : null]` (presence/absence)
- `stringAttr` — `[raw => raw, value => value == null ? null : String(value)]`

Reflection is driven by a `@slimlib/store` effect that reads `host[name]`, so a reflected
attribute **must** be declared via `props()` (otherwise the read is not reactive). In DEV a
reflected key that was not declared via `props()` logs a `console.warn`.

See `README.md` for usage and `IDEAS.md` for the roadmap.

## Advanced: bring your own registry

`createCustomElement(middleware?, render, Base?)` returns an **unregistered** `CustomElementConstructor` — it never calls `customElements.define` itself. That lets you register the class wherever you want: the global registry, a custom subclass, or a scoped `CustomElementRegistry`.

```js
import { createCustomElement, attributes } from '@slimlib/element';

const MyEl = createCustomElement([attributes({ count: [] })], (host) => {
    /* ... */
});

// Register wherever you like:
const registry = new CustomElementRegistry(); // scoped registry
registry.define('my-el', MyEl);
// or customElements.define('my-el', MyEl) for the global registry.
```

Scoped custom element registries are a newer platform feature (Chrome 146+, Safari 26+; not yet in Firefox), so feature-detect before relying on them.


