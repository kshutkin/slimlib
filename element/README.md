# @slimlib/element

Functional Custom Elements backed by [`@slimlib/jsx`](../jsx) for rendering and
[`@slimlib/store`](../store) for reactivity. Define an element with a single
function: declare reactive props, return JSX, and the element re-renders itself.

```jsx
import { attributes, defineElement, numberAttribute, props } from '@slimlib/element';

defineElement('my-counter', [attributes({ count: numberAttribute })], () => {
    const state = props({ count: 0 });
    return <button on:click={() => state.count++}>{() => state.count}</button>;
});
```

```html
<my-counter count="5"></my-counter>
```
## Installation

```bash
npm install @slimlib/element @slimlib/jsx @slimlib/store
```

Configure the JSX runtime (tsconfig or bundler):

```jsonc
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@slimlib/jsx" } }
```

## Why

- **One function per element.** No classes, no boilerplate — `props()` + JSX.
- **Attributes ↔ props, both ways.** Parse incoming attributes into reactive
  props and reflect prop writes back to the DOM, each direction opt-in.
- **Composable features.** Form association, `ElementInternals`, adopted/move
  callbacks, disabled features — added à la carte through middleware.
- **Move-safe.** Reparenting an element in the same task keeps its DOM, state,
  and subscriptions; only a genuine disconnect tears them down.

## Examples

### Reactive props and attribute reflection

```jsx
import { attributes, defineElement, booleanAttribute, numberAttribute, props } from '@slimlib/element';

defineElement('my-toggle', [attributes({ count: numberAttribute, open: booleanAttribute })], () => {
    const state = props({ count: 0, open: false });
    return (
        <button on:click={() => { state.count++; state.open = !state.open; }}>
            {() => `${state.count}${state.open ? ' ▼' : ' ▶'}`}
        </button>
    );
});
```

`state.count++` updates the prop, the view, **and** the reflected `count`
attribute. Setting `count="9"` from HTML or JS flows back into `state`.

### Side effects with lifecycle cleanup

```jsx
import { defineElement, onMount, props } from '@slimlib/element';

defineElement('mouse-x', () => {
    const state = props({ x: 0 });
    onMount(() => {
        const onMove = (event) => { state.x = event.clientX; };
        window.addEventListener('pointermove', onMove);
        return () => window.removeEventListener('pointermove', onMove); // runs on unmount
    });
    return <output>{() => state.x}</output>;
});
```

### A form-associated control

```jsx
import { defineElement, formAssociated, internals, onFormReset, props, withInternals } from '@slimlib/element';

defineElement('my-field', [withInternals(), formAssociated()], () => {
    const state = props({ value: '' });
    const elementInternals = internals();
    onFormReset(() => { state.value = ''; elementInternals.setFormValue(''); });
    return <input value={() => state.value} on:input={(e) => {
        state.value = e.target.value;
        elementInternals.setFormValue(state.value);
    }} />;
});
```

### DOM context protocol

`@slimlib/element` implements the Web Components Context Protocol separately
from `@slimlib/jsx` context. Use it to expose a stable per-element value, such
as a reactive primitive from `@slimlib/store`, to descendant elements.

```jsx
import { contextProvider, createContext, defineElement, requestContext } from '@slimlib/element';
import { signal } from '@slimlib/store';

const Theme = createContext('theme');

defineElement('theme-shell', [contextProvider(Theme, () => signal('light'))], () => <slot />);

defineElement('theme-label', () => {
    const theme = requestContext(Theme);
    return <span>{() => theme?.()}</span>;
});
```

## API

### Defining elements

| Function | Description |
| --- | --- |
| `defineElement(tag, middleware?, render)` | Register an autonomous custom element. |
| `defineBuiltinElement(tag, extendElement, middleware?, render)` | Register a customized built-in (e.g. extend `'button'`). |
| `createCustomElement(middleware?, render, Base?)` | Build an **unregistered** constructor for manual or scoped registration. |

`render` is `(host) => JSX`. It runs once per mounted period (re-running after a
genuine unmount and remount). `middleware` is an optional `Middleware[]` array
applied around the element (see below).

### Reactive props

```js
const state = props({ count: 0, label: '' });
```

Call `props(initial)` inside the render callback. It installs `host.<key>`
accessors backed by a reactive store and returns the store proxy. Read/write
`state.count` in render code or `host.count` from outside — both stay in sync.
A value already set on the host before `props()` (an attribute or `el.count = 5`)
is adopted automatically.

### Lifecycle hooks

Call these inside the render callback. Each returns `void`.

| Hook | Fires |
| --- | --- |
| `onMount(listener)` | Once per mounted period, after render. Return a function to run on genuine unmount. |
| `onConnect(listener)` | On every connect, including same-task moves. |
| `onDisconnect(listener)` | On every disconnect. |
| `onAdoptedCallback(listener)` | On `adoptedCallback` — requires `onAdopted()`. |
| `onConnectedMove(listener)` | On `connectedMoveCallback` — requires `onMove()`. |
| `onFormAssociated(listener)` | Form owner changes — requires `formAssociated()`. |
| `onFormDisabled(listener)` | Disabled-state changes — requires `formAssociated()`. |
| `onFormReset(listener)` | Form reset — requires `formAssociated()`. |
| `onFormStateRestore(listener)` | State restore — requires `formAssociated()`. |

Hooks that depend on a callback (adopted, move, form\*) need the matching
middleware; in DEV a missing one logs a warning and the subscription is ignored.

### Middleware

| Middleware | Adds |
| --- | --- |
| `attributes(config)` | Observed attributes, parsing into props, and reflection. |
| `contextProvider(context, factory)` | Handles Web Components Context Protocol requests with one stable factory-created value per element instance. |
| `rootContextProvider(context, factory)` | Like `contextProvider`, but only provides when no ancestor already provides the same context; otherwise it stays transparent and defers to that provider. |
| `formAssociated()` | `static formAssociated = true` and the form lifecycle callbacks. |
| `withInternals()` | `attachInternals()`, accessed via `internals()`. |
| `withValidation()` | `validity`, `validationMessage`, `willValidate`, `form`, `labels`, `checkValidity()`, and `reportValidity()` forwarded from `ElementInternals`; requires `withInternals()`. |
| `onAdopted()` | `adoptedCallback`, surfaced via `onAdoptedCallback`. |
| `onMove()` | `connectedMoveCallback`, surfaced via `onConnectedMove`. |
| `disabledFeatures(features)` | `static disabledFeatures` (e.g. `['shadow']`). |

### Context protocol

```js
const ContextKey = createContext('context-key');
```

`createContext(key)` returns the same key value branded with its provided
value type. Matching is by strict equality, per the Web Components Context
Protocol. Use unique symbols or objects for private contexts, and strings or
`Symbol.for()` for intentionally shared contexts.

`contextProvider(context, factory)` adds a `context-request` listener to each
element instance. The factory runs once in the element constructor and should
return a stable value. When a matching request bubbles through the provider,
the middleware calls `stopImmediatePropagation()` and invokes the request
callback with that value.

`rootContextProvider(context, factory)` provides the context only when no
ancestor already provides it. On the element's first connection it probes its
ancestors with a one-shot `context-request`; if an existing provider answers,
this element stays transparent and descendants keep resolving to that provider.
Otherwise it becomes the root provider. The decision is made once per instance,
and `factory` runs at most once — lazily, and only when this element actually
becomes the provider. Use it for components that should establish a default
("root") context unless an enclosing provider already supplies one.

`requestContext(context)` dispatches one non-subscribing request from the
current element and returns the provided value, or `undefined` when no
provider handles it. It must be called synchronously inside a `defineElement`
render callback.

For external consumers, dispatch `new ContextRequestEvent(context, callback)`.
This package does not retain callbacks for subscribing requests; provide a
reactive object when consumers need updates.

### Attributes

`attributes(config)` takes a map of `[parse?, serialize?]` tuples:

```jsx
attributes({
    count: numberAttribute,      // parse + serialize → observe + reflect
    open:  booleanAttribute,        // boolean presence
    label: [stringAttribute[0]], // parse only → observe, no reflection
    note:  [],              // inert
});
```

- `parse(raw)` — present ⇒ the attribute is **observed** and written to the prop.
- `serialize(value)` — present ⇒ prop writes are **reflected** to the attribute
  (return `null` to remove it).

Presets: `numberAttribute`, `booleanAttribute`, `stringAttribute`. Reflection reads the prop
reactively, so a reflected attribute must be declared via `props()`. A
`[parse, serialize]` pair must be round-trip stable (DEV throws if not).

### Exports for advanced use

Exported types for authoring middleware and typing hosts: `ElementHost`,
`RenderFunction`, `Middleware`.

## Bring your own registry

`createCustomElement` returns an unregistered constructor, so you choose where to
register it:

```js
import { createCustomElement } from '@slimlib/element';

const MyEl = createCustomElement([], (host) => <span>hi</span>);

customElements.define('my-el', MyEl);     // global registry
// or: new CustomElementRegistry().define('my-el', MyEl); // scoped (Chrome 146+, Safari 26+)
```

[Changelog](./CHANGELOG.md)


## License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
