# Technical debt

## Property-setter cache shared across element classes

Status: deferred; implementation unchanged.

In [src/core.ts](./src/core.ts), `applyProperty` and `resolveProperty` cache whether a property has a setter by `(tagName, propName)`. Native elements and customized built-ins share the same `tagName`, so different setter availability for the same property produces creation-order-dependent behavior. Different setter implementations alone do not cause this problem: the cache stores a boolean, not the setter itself.

### Scenario

Suppose `x-suggestions` is a registered customized built-in extending `HTMLInputElement` with a `list` setter accepting an array of suggestions. Native `input.list` is getter-only.

```jsx
<input list="countries" />
<input is="x-suggestions" list={['Rome', 'Berlin']} />
```

Both elements use the cache key `INPUT,list`:

- Native input created first: the cache records no setter, so the customized input receives an attribute instead of calling its setter. Its suggestions are not populated.
- Customized input created first: the cache records a setter, so a later native input attempts to assign its read-only `list` property, which throws in strict mode.

The customized input works when rendered alone. This scenario was reproduced in Chromium using normal element creation and rendering.

### Workaround

Use explicit prefixes on both element types to bypass the shared cache:

```jsx
<input attr:list="countries" />
<input is="x-suggestions" prop:list={['Rome', 'Berlin']} />
```

### Proposed fix

Key the cache by the element's actual prototype, then property name, using `WeakMap<object, Map<string, boolean>>`. Native and customized inputs then receive separate decisions. Continue caching only when a descriptor is found, preserving the existing behavior for elements that may gain setters after an upgrade. Keep the explicit `prop:` and `attr:` overrides.

Before implementing, compare size and performance: this adds a prototype lookup and a nested cache lookup while removing string-key construction. Regression coverage should exercise both creation orders and an element upgraded after initial rendering.
