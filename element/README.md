# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```jsx
import { defineElement } from '@slimlib/element';

// With defaults: every key becomes a reactive accessor and an observed attribute.
defineElement('my-counter', { count: 0 }, (host) =>
    <button on:click={() => host.count++}>{() => host.count}</button>
);

// No defaults: props bag is optional.
defineElement('my-banner', (host) =>
    <div>hello</div>
);
```

## Model

Each element gets a `state()`-backed reactive object behind its prototype accessors. Read `host.count` inside a reactive scope (a text or attribute effect, i.e. the `() => host.count` thunk) to subscribe; write `host.count = v` (or `host.count++`) to notify. Attribute changes flow through the same store: `observedAttributes` is derived from the keys of `defaults`, and `attributeChangedCallback` writes the raw string into the reactive state.

Shadow DOM and typed attribute coercion/reflection are not in this tier — they're tracked in `IDEAS.md` (proposals #4 and #5 Tier 2).
