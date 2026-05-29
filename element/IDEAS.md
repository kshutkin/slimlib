# @slimlib/element — design notes

Scratchpad for design ideas and follow-ups before they land in code. Each entry
is a self-contained proposal: rationale, sketch, tradeoffs, open questions.

---

## Done

- **#1 Back `props` with `state()` instead of per-key signals.** Shipped.
  `props(initial)` calls `state(initial)` from `@slimlib/store` and installs
  accessors on the host.
- **#2 PascalCase class name in DEV.** Shipped via `createNamedElementClass`;
  production constructor stays anonymous.
- **#5 Middleware-composed `defineElement`.** Shipped. The API is
  `defineElement(tag, render)` or `defineElement(tag, middleware[], render)`;
  the low-level `createCustomElement(middleware?, render, Base?)` returns an
  unregistered constructor (for custom registries / manual define), and
  customized built-ins go through `defineBuiltinElement(tag, extendElement,
  middleware?, render)`. Slim core is
  innermost; user middleware composes outward via `reduceRight`. Baseline kit
  exports: `observedAttributes`, `disabledFeatures`, `formAssociated`,
  `withInternals`, `onAdopted`, `onMove`. See `README.md` for usage and
  `src/index.js` for the wrapper. The original Tier 2 (options bag) and
  Tier 3 (compiler plugin) are obsolete — replaced and deferred respectively.
- **#6 lazy declaration verdict.** Confirmed by the implementation:
  observed-attribute names are declared at `defineElement` time via the
  `observedAttributes()` middleware; JS-only reactive state is declared
  lazily inside `render` via `props()`.
- **#7 ElementInternals & form-associated elements.** Folded into #5. Class-
  time `formAssociated` is the `formAssociated()` middleware (sets
  `static formAssociated`, installs the four form callbacks). Per-instance
  access is `host._internals`, populated by `withInternals()` (opt-in, so
  elements that don't ask don't allocate).
- **#8 Other class-time configuration.** Folded into #5. `disabledFeatures`,
  `adoptedCallback`, `connectedMoveCallback`, form-association callbacks,
  customized built-ins — all shipped as middlewares (or, for built-ins, via
  the dedicated `defineBuiltinElement` facade). Wrapper-owned
  `connected`/`disconnected`/`attributeChanged` stay inside the slim core.

---

## 3. Customized built-in elements — JSX runtime piece

The wrapper side is shipped via `defineBuiltinElement(tag, 'button', mw, render)`.
What remains is the JSX-runtime change required to make `<button is="my-tag">`
actually upgrade in markup produced by `@slimlib/jsx`.

### Problem
`document.createElement('button', { is: 'my-tag' })` is the only call form
the browser honours for `is`-upgrade. `el.setAttribute('is', 'my-tag')`
after the fact does NOT upgrade the element. The current jsx runtime calls
`document.createElement(type)` without the options bag (see `jsx/src/core.ts`),
so `<button is="my-counter" />` never upgrades when produced by jsx.

### Proposal
In the jsx runtime, detect an `is` prop on a host-tag element and pass it as
the second `createElement` arg:

```js
const isProp = props?.is;
const el = isProp
    ? document.createElement(type, { is: isProp })
    : document.createElement(type);
```

Cost: one extra prop sniff per host-tag element. Negligible.

### Open questions
- Safari does not implement customized built-ins. Two options: require
  `@ungap/custom-elements` polyfill, or document the feature as
  Chromium + Firefox only. Autonomous elements work everywhere — this is
  strictly an *additional* mode.
- Most built-ins (`button`, `input`, `select`, …) throw on `attachShadow()`.
  Non-issue today (no shadow DOM mode in `@slimlib/element`); revisit if a
  shadow-root mode is ever added.
- TypeScript: `host` handed to `render` should narrow to the matching
  built-in (`HTMLButtonElement` when `extendElement === 'button'`). A small
  lookup type plus a generic on `defineElement` does this without ceremony.

---

## 4. Attribute reflection and typed attribute coercion

### Current
`observedAttributes([...])` (middleware) and `props()` (called inside render)
are two independent channels sharing internal storage:
- Setting `el.foo = v` runs the prop accessor installed by `props()`, which
  writes to the `state()`-backed proxy.
- Changing the `foo` HTML attribute fires `attributeChangedCallback`, which
  writes the raw `string | null` into `this[name]` — either onto the
  pre-mount own property (later adopted by `props()`) or through the accessor.

Two gaps follow from "two channels, no glue":

1. **Type drift.** Attribute path always delivers `string | null`. Prop path
   delivers whatever JS assigns. With both wired to the same storage, the
   value's runtime type depends on which side wrote last. `count="5"` →
   `'5'`; `el.count = 5` → `5`.
2. **No reflection.** Writing `el.count = 5` does not update the HTML
   attribute, so devtools, CSS attribute selectors, and SSR diffs do not see
   the change.

### Proposal

Extend `props()` so each prop can carry coercion + reflection metadata:

```js
defineElement('my-counter', [observedAttributes(['count', 'open', 'label'])], host => {
    const p = props({
        count: { value: 0, type: Number, reflect: true },
        open:  { value: false, type: Boolean, reflect: true },
        label: { value: '',    type: String }, // observe, don't reflect
    });
    // …
});
```

Semantics:
- `type: Number | Boolean | String | <fn>` — coercion applied when an
  attribute value (`string | null`) flows in. Boolean treats presence-as-true
  / absence-as-false. Custom functions get `(raw: string | null) => T`.
- `reflect: true` — sync prop → attribute on write. Numbers/strings stringify
  via `String(v)`; booleans add/remove the attribute. `null`/`undefined`
  remove the attribute.

### Implementation sketch
- Detect descriptor form by sniffing for `value`/`type`/`reflect` as own
  keys (vs the shorthand `props({ count: 0 })` form).
- Build a normalized descriptor map at `props()` call time.
- `attributeChangedCallback(name, _, raw)` applies `type` coercion, sets a
  `_reflecting` flag, writes through the prop setter, clears the flag.
- The prop setter writes to internal storage. If `reflect` is true AND
  `_reflecting` is not set (write originated from JS), it also calls
  `setAttribute` / `removeAttribute`.

### Tradeoffs
- Shorthand `props({ count: 0 })` must keep working — runtime branches on
  "descriptor or bare default". Easy to get wrong when defaults are objects
  (`{ value: 0 }` IS a descriptor; `{ x: 0, y: 0 }` isn't). Rule: a value is
  a descriptor iff it has at least one of `value`/`type`/`reflect` as own
  keys. Document; consider requiring `descriptor: true` if collisions feel
  risky.
- Boolean attributes are a special case: presence is true, absence is false,
  any value (including `"false"`) is true.
- Reflection introduces a write-loop guard. Standard pattern, extra state
  per instance.

### Open questions
- Should `type` also coerce *outbound* writes (`el.count = "5"` → `5`)? Lit
  does. Strict but rejects accidental string assignments.
- Computed/derived attributes (read-only, reflected from a value): defer.
- Could also be expressed as a `reflectedProps({...})` middleware — keeps the
  descriptor table at class-time. Probably overkill; per-instance is fine.

---

## 5. Open questions left from middleware composition (#5 shipped)

The middleware design landed (see Done). A few tradeoffs are still live and
will only be settled by real usage:

1. **TypeScript typing of additive middleware.** `withInternals()` should
   make `host._internals: ElementInternals` show up inside `render`. Doable
   with a generic `Middleware<Adds = {}>` and a typed compose that
   intersects each layer's `Adds`. Mid-effort. JS API ships first.
2. **Static-field conflicts.** Two middlewares both setting
   `static observedAttributes` → later one shadows. Add
   `mergeObservedAttributes` only if real conflicts surface.
3. **Render hook as middleware?** The slim core is effectively a fixed
   innermost middleware. Exposing it as user-replaceable would be an escape
   hatch for power users who want a different lifecycle contract. Probably
   not worth the API surface.
4. **DEV-time per-middleware validation.** Each middleware could carry its
   own checks (e.g. `observedAttributes` warns on duplicate names,
   `withInternals` warns if applied twice). Standard pattern, no central
   registry. Add lazily.
5. **Naming.** `middleware` won. `mixins` would also have been fine.
   `decorators` was avoided as too loaded.

---

## 6. `bindAttribute` helper

The lazy-prop story is done; the only residual question is whether to offer
a sugar helper that pulls attribute *use* closer to the render code:

```js
defineElement('my-counter', [observedAttributes(['count'])], host => {
    const count = bindAttribute(host, 'count'); // sugar; spec-safe because attr is in the schema
    return <button on:click={() => count.set(count() + 1)}>{count}</button>;
});
```

Spec-safe: assumes the attribute is already in the schema declared at
`defineElement` time. Returns a reactive binding to the current value plus
a coercion hook (which would route through whatever #4 lands).

### Open question
Is this worth shipping, or is the prototype accessor (`host.count`) enough
for every realistic case? Likely the accessor suffices; revisit only if #4
makes the descriptor form ergonomically heavy at the call site.

---

## 7. Compiler plugin (lowest priority, philosophy-misaligned)

The remaining `() => host.x` boilerplate in JSX expression positions is
removable by a Rollup/Vite plugin that wraps member-read expressions in
arrows. **Lowest priority. Misaligned with the library's "explicit over
magic" philosophy.** Do not implement unless multiple consumers ask. If
implemented later, it must be:

- Optional. Runtime code must keep working without the plugin.
- Scoped narrowly to JSX member-reads. No bare-identifier rewrites, no
  destructuring magic, no `count++` shorthand for non-host state.
- Behind an explicit opt-in marker (e.g. a `component()` factory rather
  than `defineElement()`), so users see at the call site that the rewrite
  applies.
- In a separate package (`@slimlib/element-plugin`), so the runtime has no
  implicit dependency on a build step.
