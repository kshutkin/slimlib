# @slimlib/element — design notes

Scratchpad for design ideas and follow-ups before they land in code. Each entry
is a self-contained proposal: rationale, sketch, tradeoffs, open questions.

---

## Done / no longer relevant

- **#1 Back `props` with `state()` instead of per-key signals** — shipped.
  `props(initial)` calls `state(initial)` from `@slimlib/store` and installs
  accessors on the host.
- **#2 PascalCase class name in DEV** — shipped via `createNamedElementClass`;
  production constructor stays anonymous.
- **#5 Tier 1 (positional API + in-render declaration)** — shipped, in a
  shape close to but not identical to the original proposal. Current signature
  is `defineElement(tag, attrs?, render)`, with prop defaults declared
  lazily via `props({...})` inside the render callback (closer to #6's
  conclusion). The proposal's `(tag, defaults, render)` form was not adopted —
  worth re-framing #5 Tier 2/3 against the actual shape when revisiting.
- **#6 verdict on lazy declaration** — confirmed by the implementation:
  attributes stay declared at `defineElement` time (the `attrs` array drives
  `observedAttributes`); JS-only reactive state is declared lazily inside
  render via `props()`. The "what's reachable" analysis is realized; the
  residual `bindAttribute` open question carries forward into #4.

---

## 3. Support customized built-in elements (extend HTMLButtonElement, etc.)

### Current
`defineElement` hard-codes `class extends HTMLElement` — only the
"autonomous" custom element form (`<my-counter>`) is supported.

### Proposal
Accept a fourth `extendElement` argument (string, the local name of the
built-in to extend). The wrapper resolves it to the matching constructor
(`HTMLButtonElement`, `HTMLInputElement`, …) and uses that as the starting
base for the #5 middleware chain. The same string is passed as the third
arg to `customElements.define`.

```js
defineElement(
    'my-counter',
    observedAttributes(['count']),
    render,
    'button', // → base resolved to HTMLButtonElement
);
// internally:
const Base = document.createElement('button').constructor; // → HTMLButtonElement
let Ctor = applySlimCore(Base, render);
Ctor = layers.reduceRight((acc, mw) => mw(acc), Ctor);
customElements.define('my-counter', Ctor, { extends: 'button' });
```

No separate `base:` option — middleware composition extends whatever the
wrapper hands it, so there is only one input that needs to agree
(`extendElement` resolves to the right constructor and is passed through to
`customElements.define`).

Consumer markup becomes `<button is="my-counter">` instead of `<my-counter>`.
Lifecycle, attribute callback, and state wiring are identical — the body only
cares that the parent is *some* HTMLElement subclass.

### Wins
- Inherits semantics, accessibility, and form participation of the built-in
  for free. Extending `HTMLButtonElement` gets you click/keyboard/focus
  behaviour and form-submit participation without any `ElementInternals` work.
- Author can progressively enhance existing markup: `<button is="my-counter">`
  degrades to a plain button if the script never loads.

### Caveats

1. **Safari does not ship customized built-ins.** WebKit has declined the
   feature for years. Two options: require the `@ungap/custom-elements`
   polyfill in Safari, or document this mode as Chromium + Firefox only.
   Autonomous elements (`extends HTMLElement`) work everywhere — this proposal
   is strictly an *additional* mode.

2. **Shadow DOM is mostly blocked.** Most built-ins (`button`, `input`,
   `select`, `textarea`, etc.) throw on `attachShadow()`. Currently a non-issue
   because `@slimlib/element` does not use shadow DOM at all; becomes relevant
   only if a shadow-root mode is added later.

3. **`is=` must be set at element creation time.** Setting
   `el.setAttribute('is', 'my-counter')` after the element exists does NOT
   upgrade it. The browser only honours `is` when:
   - the parser sees the attribute in the initial HTML, or
   - `document.createElement('button', { is: 'my-counter' })` is used.

   The current jsx runtime calls `document.createElement(type)` without the
   options bag (see `jsx/src/core.ts`). To make `<button is="my-counter" />`
   actually upgrade, the runtime needs to detect an `is` prop and pass it via
   the options arg at creation time. That's a small but real runtime change —
   separate proposal in the jsx package.

4. **TypeScript surface.** With `extendElement` as a single string, the
   `host` parameter handed to `render` should narrow to the matching
   built-in (`HTMLButtonElement` when `extendElement === 'button'`, etc.).
   A small lookup type (`{ button: HTMLButtonElement; input: HTMLInputElement;
   … }`) plus a generic on `defineElement` does this without ceremony.
   Customised built-ins outside the lookup fall back to `HTMLElement`.

### Open questions
- Do we want this in v1, or punt until a real consumer asks? Plumbing in
  `defineElement` is trivial; friction is (a) the `createElement('button',
  { is })` change in `@slimlib/jsx`, and (b) deciding the Safari policy
  (polyfill vs unsupported).
- If we ship it, expose an `is`-aware JSX helper (e.g. an
  `elementIs(tag, is, props, children)` factory) for ergonomics, or just rely
  on the runtime detecting an `is` prop?

---

## 4. Attribute reflection and typed attribute coercion

### Current
`attrs` (second arg of `defineElement`) and `props()` (called inside render)
are two independent channels sharing internal storage:
- Setting `el.foo = v` runs the prop accessor installed by `props()`, which
  writes to the `state()`-backed proxy.
- Changing the `foo` HTML attribute fires `attributeChangedCallback(name, _, v)`,
  which writes the raw `string | null` into `this[name]` — either onto the
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

Extend `props()` (or add a parallel descriptor channel) so each prop can
carry coercion + reflection metadata. Sketch:

```js
defineElement('my-counter', ['count', 'open', 'label'], host => {
    const p = props({
        count: { value: 0, type: Number, reflect: true },
        open:  { value: false, type: Boolean, reflect: true },
        label: { value: '',    type: String }, // observe, don't reflect
    });
    // …
});
```

Semantics:
- `type: Number | Boolean | String | <fn>` — coercion function applied when
  an attribute value (`string | null`) flows in. Boolean treats
  presence-as-true / absence-as-false (HTML idiom). Custom functions get
  `(raw: string | null) => T`.
- `reflect: true` — sync prop → attribute on write. Numbers / strings
  stringify via `String(v)`; booleans add/remove the attribute. `null` /
  `undefined` remove the attribute.

Open shape question: should the descriptor table subsume the `attrs` array
(single source of truth for observed names), or stay a separate concern
that augments it? The former is cleaner; the latter is incremental and
keeps the current API working untouched.

### Implementation sketch

- Detect descriptor form by sniffing for `value`/`type`/`reflect` as own
  keys (vs the shorthand `props({ count: 0 })` form, which is a bare
  default).
- Build a normalized descriptor map at `props()` call time.
- `attributeChangedCallback(name, _, raw)` looks up the descriptor by
  attribute name, applies `type` coercion, sets a `_reflecting` flag, writes
  through the prop setter, clears the flag.
- The prop setter writes to internal storage. If `reflect` is true AND
  `_reflecting` is not set (i.e. write originated from JS, not the
  attribute callback), it also calls `setAttribute` / `removeAttribute`.

The `_reflecting` flag is the standard guard against infinite ping-pong.

### Wins

- Attributes get correct JS types automatically — no per-component coercion
  boilerplate.
- HTML attribute stays in sync with JS prop where the author opts in — better
  devtools, CSS hookability via `[count="5"]` selectors, SSR diff alignment.
- Single declarative table for the common case where attributes and props
  overlap.

### Tradeoffs

- API surface grows. The shorthand `props({ count: 0 })` must keep working,
  so the runtime branches on "is this a descriptor or a bare default?".
  Easy to get wrong when defaults are themselves objects (`{ value: 0 }` *is*
  a descriptor; `{ x: 0, y: 0 }` isn't). Resolution rule: a value is a
  descriptor iff it has at least one of `value`, `type`, `reflect` as own
  keys. Document explicitly; consider requiring an explicit `descriptor: true`
  marker if collisions feel risky.
- Boolean attributes are a special case: presence is true, absence is false,
  any value (including `"false"`) is true. Must implement and document.
- Reflection introduces a write loop guard. Standard pattern but extra state
  per instance.

### Open questions

- Should `type` also coerce *outbound* writes (i.e. `el.count = "5"` becomes
  `5` because `type: Number`)? Lit does this; it makes the prop strict but
  rejects accidental string assignments. Either choice is defensible.
- Should there be a way to declare a *computed* attribute (read-only,
  reflected from a derived value)? Likely yes eventually, deferred.
- Does the descriptor table fully subsume `attrs`, or augment it?
  Subsumption is cleaner long-term; augmentation is a safer first step.

---

## 5. Middleware-composed `defineElement`

Supersedes the old Tier 2 (options bag), #7 (ElementInternals helper), and
#8 (lifecycle hook bag). Each "class-time concern" — every static field and
every prototype method the browser reads once at registration — becomes a
small composable function instead of a key in a closed options object.
Users can write their own without us shipping it.

### Shape

```ts
type Middleware = (Base: typeof HTMLElement) => typeof HTMLElement;

defineElement(
    tag: string,
    middleware: Middleware | Middleware[],
    render: (host: HTMLElement) => Node | null,
    extendElement?: string, // e.g. 'button' for customized built-ins (#3)
): void;
```

Each middleware receives a base class and returns a subclass. The wrapper
folds them onto a starting base (resolved from `extendElement`, default
`HTMLElement`), then layers its own slim core (connected/disconnected/
attributeChanged dispatchers + render wiring) innermost, then registers.

```js
function defineElement(tag, middleware, render, extendElement) {
    const parent = extendElement
        ? document.createElement(extendElement).constructor
        : HTMLElement;
    const layers = Array.isArray(middleware) ? middleware : [middleware];
    let Ctor = applySlimCore(parent, render);
    Ctor = layers.reduceRight((acc, mw) => mw(acc), Ctor);
    if (DEV) Ctor = pascalNamed(tag, Ctor);
    customElements.define(
        tag, Ctor,
        extendElement ? { extends: extendElement } : undefined,
    );
}
```

Order convention: array index 0 is the outermost layer (`reduceRight`).
Same as Redux/Koa.

### Shipped middlewares (the baseline kit)

Each is a one-liner producing a `Middleware`. They cover everything in the
old #7 / #8 lists.

```js
// Static fields read once by the registry
observedAttributes(['value', 'count'])       // sets static observedAttributes
formAssociated({                              // sets static formAssociated = true,
    reset:    host => {},                     //   installs the four form callbacks
    disabled: (host, d) => {},                //   on the prototype only when present
    associated: (host, form) => {},
    stateRestore: (host, state, mode) => {},
})
disabledFeatures(['shadow'])                  // sets static disabledFeatures

// Per-instance allocation that needs prototype presence
withInternals()                               // adds _internals = this.attachInternals()
                                              //   in the constructor; gives ARIA mixin,
                                              //   custom states, and (combined with
                                              //   formAssociated()) setFormValue access

// Niche lifecycle hooks
onAdopted((host, oldDoc, newDoc) => {})       // installs adoptedCallback
onMove(host => {})                            // installs connectedMoveCallback
```

User-written middleware for anything we don't ship is trivial:

```js
const withDataset = (key, value) => Base =>
    class extends Base {
        constructor() { super(); this.dataset[key] = value; }
    };
```

### Full example

```js
defineElement(
    'my-input',
    [
        observedAttributes(['value']),
        formAssociated({ reset: host => host.value = '' }),
        withInternals(),
    ],
    host => {
        const p = props({ value: '' });
        effect(() => host._internals.setFormValue(p.value));
        return null;
    },
    'input', // customized built-in (#3)
);
```

### Integration with other proposals

- **#3 Customized built-ins** — collapses to the `extendElement` argument.
  Wrapper resolves the local name to its constructor (`HTMLButtonElement`,
  `HTMLInputElement`, …) and threads it as the starting base. The same
  string is passed as `{ extends }` to `customElements.define`. No
  separate `base:` config — middleware composition already extends whatever
  the wrapper hands it.
- **#4 Attribute reflection / typed coercion** — orthogonal: still
  per-instance, still happens inside `props()`. Could be expressed as a
  middleware too (`reflectedProps({...})`) if the descriptor table needs
  class-time wiring, but the current sketch keeps it per-instance and
  unchanged.
- **#6 `bindAttribute`** — unchanged, orthogonal, still per-instance.

### Wins

- **Open extension.** Users add new class-time behaviour without a runtime
  change. Everything in #8 that we'd have to enumerate becomes a shipped
  function in the same shape.
- **Pay-for-what-you-use.** `withInternals()` is opt-in — elements that
  don't need ElementInternals don't allocate one. Same for every other
  middleware.
- **Customized built-ins fall out for free.** Same `withInternals()` /
  `formAssociated()` middlewares work whether the base is `HTMLElement`,
  `HTMLButtonElement`, or anything else, because middleware composes
  generically.
- **Smaller core.** The wrapper only knows about the slim core; everything
  else is a separate import.

### Tradeoffs / open questions

1. **Always an array.** Middleware is `Middleware[]`. Even a single-entry
   chain wraps in `[mw]`. The bare-function shorthand was rejected: it
   forced a runtime branch in the wrapper for negligible call-site savings,
   and it muddled the type story. One shape, no detection.
2. **Application order.** `reduceRight` (array[0] outermost). Document
   once; do not bikeshed.
3. **Slim core position.** Innermost. User middleware sees the slim core
   as part of the base it extends. Means a user middleware *can* override
   `connectedCallback` etc. — escape hatch, not footgun, if documented.
4. **Static-field conflicts.** If two middlewares both set
   `static observedAttributes`, the later (innermore) class shadows the
   earlier. Ship the dumb version first; add a merging helper
   (`mergeObservedAttributes`) only if real conflicts surface.
5. **TypeScript typing.** The interesting part: typing `withInternals()`
   so `host._internals` shows up in the `render` callback's `host` type.
   Doable with a generic `Middleware<Adds = {}>` and an array-typed
   accumulator, but it's mid-effort. Ship the JS API first; type later.
6. **Memoisation.** Per `defineElement` call rebuilds the class chain.
   This is one-shot at module load — not worth caching. The built-in
   resolution (`document.createElement(name).constructor`) is inlined at
   the one call site; if profiling ever shows it matters, drop in a tiny
   `Map<string, Ctor>` cache.
7. **Naming.** `middleware` (singular, accepts one or array). `mixins` is
   also fine. `decorators` is loaded — avoid.
8. **DEV-time validation.** Each middleware can carry its own DEV checks
   (e.g. `observedAttributes` warns on duplicate names, `withInternals`
   warns if called twice in the chain). Standard pattern; no central
   registry needed.
9. **Render hook as middleware?** Could be — the slim core itself is just
   another middleware applied automatically. Keeping `render` as a
   first-class positional parameter is friendlier for the common case;
   advanced users who want to skip the slim core can build their own
   `defineElement`-equivalent on top of the same primitives.

### Status of the old subsections

- Old **Tier 2 (options bag)** — replaced by middleware. No options bag.
- Old **Tier 3 (compiler plugin)** — unchanged; preserved below.
- Old **#7 (ElementInternals split)** — `internals()` helper dropped;
  `withInternals()` middleware + `host._internals` covers both use cases.
  Class-time `formAssociated` config is the `formAssociated()` middleware.
- Old **#8 (class-time bag)** — every entry becomes a middleware in the
  shipped kit. The note about wrapper-owned `connected`/`disconnected`/
  `attributeChanged` carries forward: those stay inside the slim core,
  not exposed as middlewares.

### Tier 3 — compiler plugin (lowest priority, philosophy-misaligned)

The remaining `() => host.x` boilerplate in JSX expression positions is
removable by a Rollup/Vite plugin that wraps member-read expressions in
arrows. **Lowest priority. Misaligned with the library's "explicit over
magic" philosophy.** Document as a possibility but do not implement unless
multiple consumers ask. If implemented later, it must be:
- Optional. Tier 1/2 code must keep working without the plugin.
- Scoped narrowly to JSX member-reads. No bare-identifier rewrites, no
  destructuring magic, no `count++` shorthand for non-host state.
- Behind an explicit opt-in marker (e.g. a specific factory name like
  `component()` instead of `defineElement()`), so users see at the call
  site that the rewrite applies.
- In a separate package (`@slimlib/element-plugin`), so the runtime has no
  implicit dependency on a build step.

---

## 6. `bindAttribute` helper

Carryover from the #6 "what's reachable" analysis. The lazy-prop story is
done; the only residual question is whether to offer a sugar helper that
pulls attribute *use* closer to the render code:

```js
defineElement('my-counter', ['count'], host => {
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

<!-- old #7 and #8 collapsed into #5 (middleware-composed defineElement) -->

## 7. ElementInternals & form-associated elements — superseded by #5

Folded into the middleware kit. Class-time `formAssociated` becomes the
`formAssociated()` middleware (sets `static formAssociated`, installs the
four form callbacks). Per-instance access drops the `internals()` helper
in favour of `host._internals`, populated by the `withInternals()`
middleware (`_internals = this.attachInternals()` in the constructor —
opt-in, so elements that don't ask don't allocate).

---

## 8. Other class-time configuration — superseded by #5

Every entry (`disabledFeatures`, `adoptedCallback`, `connectedMoveCallback`,
form-association callbacks, customized built-ins) is a shipped middleware
in the #5 kit, plus the `extendElement` argument for built-in extension.
Wrapper-owned `connected`/`disconnected`/`attributeChanged` stay inside
the slim core, not exposed as middlewares.
