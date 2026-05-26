# @slimlib/element

Functional wrapper for defining Custom Elements backed by `@slimlib/jsx` with reactive properties via `@slimlib/store`.

> WIP — API may change.

## Usage

```js
import { defineElement } from '@slimlib/element';

defineElement({
    tag: 'my-counter',
    props: { count: 0 },
    observedAttributes: ['count'],
    shadow: true,
    setup: ({ props }) => <button onclick={() => props.count.set(props.count() + 1)}>{props.count}</button>
});
```
