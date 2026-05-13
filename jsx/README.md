# JSX

Mini JSX renderer for web components with reactive primitives.

## Why This Library

A tiny JSX runtime aimed primarily at building web components, with first-class
support for `@slimlib/store` signals as reactive bindings for props, attributes,
and children. No virtual DOM, no scheduler magic — JSX expressions produce real
DOM nodes, and reactive values create fine-grained subscriptions on the spot.

- **Tiny and tree-shakable** — pay only for what you use
- **Web-components first** — custom elements, properties vs attributes, and slots are the default model
- **Reactive by default** — functions in props/children become live bindings via `@slimlib/store`
- **No build-time magic** — works with the standard JSX automatic runtime

[Changelog](./CHANGELOG.md)

## Status

Scaffold — public API is wired up but the renderer is not yet implemented.

## Installation

```bash
npm install @slimlib/jsx
```

Configure your bundler / tsconfig to use the automatic JSX runtime:

```json
{
    "compilerOptions": {
        "jsx": "react-jsx",
        "jsxImportSource": "@slimlib/jsx"
    }
}
```

## API

### `createElement(type, props, ...children)`

Low-level hyperscript factory. Used by the JSX runtime; you can also call it directly.

### `render(child, container)`

Mounts a JSX child into a DOM container and returns a dispose function.

### `Fragment`

Symbol used as the element type for grouping children without a wrapper element.
