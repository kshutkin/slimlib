# @slimlib/element — design notes

Scratchpad for design ideas and follow-ups before they land in code. Each entry
is a self-contained proposal: rationale, sketch, tradeoffs, open questions.

---

## Done

- **#4 Attribute reflection and typed coercion (Option A).** Shipped. The
  `observedAttributes` middleware was renamed to `attributes` and now owns the
  whole attribute channel: observe (`static observedAttributes`), coerce
  inbound (`coerceIn`), and reflect outbound (`reflectOut`). Config is either
  an array of names (`attributes(['count'])`) or a descriptor map
  (`attributes({ count: { type: Number, reflect: true } })`). The slim core no
  longer has an `attributeChangedCallback` — attribute handling is purely
  middleware. Reflection runs through one EAGER `@slimlib/store` `effect` per
  reflected key that reads `host[name]` (so it tracks the `props()`-installed
  accessor / reactive proxy, including the `state.count++` path). Attribute
  removal delivers `null` (Boolean → `false`); the middleware does not restore
  a default. The "only write if different" checks in `reflectOut` are the loop
  guard, so reflect → setAttribute → attributeChangedCallback → prop settles
  (also relying on `state()`'s `Object.is` dedupe). DEV warns when a
  `reflect: true` key is not declared via `props()`. Effects live outside the
  jsx render scope, so they are disposed manually in `disconnectedCallback` and
  recreated in `connectedCallback` (covers both the synchronous move case and a
  later remount). This resolves §4.1: the open timing question was settled by
  setting up reflection **after** `super.connectedCallback()` (which runs the
  core render + `props()`), so the accessors exist before the effects read
  them. Per §4.1, keys are still repeated across the (now-renamed) `attributes`
  schema and `props()`; that's accepted for v1.
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
  exports: `attributes`, `disabledFeatures`, `formAssociated`,
  `withInternals`, `onAdopted`, `onMove`. See `README.md` for usage and
  `src/index.js` for the wrapper. The original Tier 2 (options bag) and
  Tier 3 (compiler plugin) are obsolete — replaced and deferred respectively.
- **#6 lazy declaration verdict.** Confirmed by the implementation:
  observed-attribute names are declared at `defineElement` time via the
  `attributes()` middleware; JS-only reactive state is declared
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
  `connected`/`disconnected` stay inside the slim core; `attributeChanged`
  moved out to the `attributes` middleware under Option A.
- **#3 JSX runtime `is`-upgrade for customized built-ins.** Shipped. The
  jsx runtime sniffs an `is` prop and passes the options bag —
  `document.createElement(type, { is })` — so `<button is="my-tag" />`
  upgrades in markup produced by `@slimlib/jsx`. See `jsx/src/core.ts`
  (`createElementArray`). Caveats unchanged: Safari lacks customized
  built-ins (needs `@ungap/custom-elements` or Chromium/Firefox-only docs),
  and most built-ins throw on `attachShadow()` (non-issue today, no shadow
  mode). Remaining follow-up: TypeScript narrowing of `host` to the matching
  built-in (`HTMLButtonElement` for `extendElement === 'button'`) is still
  open — tracked with the additive-middleware typing work in #5.1.

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

## 4.1 Separate helper for attribute-backed state

Instead of extending `props()` with a second descriptor mode, keep `props()`
as the JS-only helper and add a sibling helper for attribute-backed state.
Tentative name: `attrs()` (clearer than `reflectedProps()` because coercion
without reflection is still a valid use case).

### Rationale
- Keeps `props({ count: 0 })` simple and avoids descriptor-vs-shorthand
  ambiguity.
- Matches the actual split in the platform/API surface: attribute schema is
  class-time (`observedAttributes([...])`), while reactive state is still
  declared lazily inside `render`.
- Gives the typed/reflected path its own stricter contract without making the
  default helper pay the complexity cost.

### Sketch

```js
defineElement('my-counter', [observedAttributes(['count', 'open', 'label'])], host => {
    const a = attrs({
        count: { value: 0, type: Number, reflect: true },
        open: { value: false, type: Boolean, reflect: true },
        label: { value: '' },
    });
    const p = props({ hovering: false });
    // ...
});
```

Semantics:
- `attrs()` is descriptor-only. Bare defaults stay on `props()`.
- `observedAttributes([...])` stays required. A render-time helper cannot
  declare `static observedAttributes` after the class is defined.
- `type` applies to attribute-originated `string | null` input in v1.
  Boolean remains presence/absence based.
- `reflect: true` syncs JS writes back to the DOM attribute.
- Attribute removal resets to the descriptor default `value` (avoids
  `Number(null) === 0` / `String(null) === 'null'` surprises).

### Implementation notes
- The current core writes raw attribute values to `this[name]` before `render`
  runs. `attrs()` therefore cannot be a thin wrapper around `props()`; it
  needs the same adoption path plus a small core-integrated buffer/guard for
  pre-mount attribute writes.
- Writes through the returned reactive object must reflect too. Reflecting only
  from `host.foo = ...` would miss the common `state.foo++` path used inside
  render.
- Use a per-attribute reflection guard rather than one instance-wide boolean,
  so nested reflected writes do not suppress unrelated attributes.

### Tradeoffs
- Repeats keys across `observedAttributes([...])` and `attrs({...})`. Acceptable
  in v1; add a DEV-time throw when `attrs()` references an attribute that is not
  observed.
- More surface area (`props()` + `attrs()`), but the type signatures stay much
  cleaner than an overloaded descriptor form on `props()`.
- Dashed attribute names need an explicit rule (`attrs({ 'foo-bar': ... })` or
  a future `attr` alias field). Do not guess camelCase/dash-case implicitly.

### Open questions
- Naming: `attrs()` feels right; `reflectedProps()` is more literal but too
  narrow if `reflect` is optional.
- Should `type` normalize all writes, not just attribute-originated ones?
- Should duplicate keys across `props()` / `attrs()` / multiple `attrs()` calls
  throw in DEV? Probably yes.

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
