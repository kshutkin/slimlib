# @slimlib/element

Functional Custom Elements backed by [`@slimlib/jsx`](../jsx) for rendering and
[`@slimlib/store`](../store) for reactivity. Define an element with a single
function: declare reactive props, return JSX, and the element re-renders itself.

```jsx
import { attributes, defineElement, numberAttr, props } from '@slimlib/element';

defineElement('my-counter', [attributes({ count: numberAttr })], () => {
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
import { attributes, defineElement, boolAttr, numberAttr, props } from '@slimlib/element';

defineElement('my-toggle', [attributes({ count: numberAttr, open: boolAttr })], () => {
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
import { defineElement, formAssociated, onFormReset, props, withInternals } from '@slimlib/element';

defineElement('my-field', [withInternals(), formAssociated()], (host) => {
    const state = props({ value: '' });
    onFormReset(() => { state.value = ''; host._internals.setFormValue(''); });
    return <input value={() => state.value} on:input={(e) => {
        state.value = e.target.value;
        host._internals.setFormValue(state.value);
    }} />;
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
| `formAssociated()` | `static formAssociated = true` and the form lifecycle callbacks. |
| `withInternals()` | `attachInternals()`, exposed as `host._internals`. |
| `onAdopted()` | `adoptedCallback`, surfaced via `onAdoptedCallback`. |
| `onMove()` | `connectedMoveCallback`, surfaced via `onConnectedMove`. |
| `disabledFeatures(features)` | `static disabledFeatures` (e.g. `['shadow']`). |

### Attributes

`attributes(config)` takes a map of `[parse?, serialize?]` tuples:

```jsx
attributes({
    count: numberAttr,      // parse + serialize → observe + reflect
    open:  boolAttr,        // boolean presence
    label: [stringAttr[0]], // parse only → observe, no reflection
    note:  [],              // inert
});
```

- `parse(raw)` — present ⇒ the attribute is **observed** and written to the prop.
- `serialize(value)` — present ⇒ prop writes are **reflected** to the attribute
  (return `null` to remove it).

Presets: `numberAttr`, `boolAttr`, `stringAttr`. Reflection reads the prop
reactively, so a reflected attribute must be declared via `props()`. A
`[parse, serialize]` pair must be round-trip stable (DEV throws if not).

### Exports for advanced use

Exported types for authoring middleware and typing hosts: `SlimHost`,
`SlimRender`, `Middleware`.

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


