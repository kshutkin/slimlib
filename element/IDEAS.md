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
Accept an optional base constructor and the local tag name to extend. Since
the current API is positional, a third form would be needed (options bag, or
a separate factory):

```js
defineElement('my-counter', ['count'], render, {
    base: HTMLButtonElement, // default: HTMLElement
    extends: 'button',       // required iff base !== HTMLElement
});
// internally:
class SlimElement extends base { /* unchanged body */ }
customElements.define(tag, SlimElement, extendsBuiltin ? { extends: extendsBuiltin } : undefined);
```

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

4. **TypeScript surface gets fiddly.** `base` and `extends` must agree
   (you can't extend `HTMLButtonElement` and pass `extends: 'div'`). A
   discriminated union of `{ base: HTMLElement } | { base: HTMLButtonElement;
   extends: 'button' } | …` is doable but verbose. Acceptable first cut: type
   `base` as `typeof HTMLElement` and `extends` as `string | undefined`, trust
   the user.

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

## 5. Surface ergonomics — what remains after Tier 1

Tier 1 (positional API + lazy `props()` inside render) has shipped (see
"Done"). The remaining tiers from the original proposal are only relevant
in the contexts described below.

### Tier 2 — options bag for declarative configuration

When proposals #3 (customized built-ins) and #4 (descriptors / reflection)
land, the positional form can't carry their config cleanly. At that point,
an options-bag overload becomes worthwhile:

```js
defineElement('my-counter', {
    attrs: ['count'],
    base: HTMLButtonElement, // #3
    extends: 'button',       // #3
    render: host => /* … */,
});
```

Same ergonomics inside `render` — the only difference is that the
declaration lives in a config object instead of positional arguments.
Detect "options bag vs attrs array" by sniffing the second argument
(`Array.isArray` for attrs, plain object for options). Falls out naturally
without ambiguity.

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

---

## 7. ElementInternals & form-associated elements

### The split
ElementInternals straddles two registers that the current API cannot bridge
on its own:
- **Class-time**: `static formAssociated = true` must be set on the constructor
  before `customElements.define`, and four form-lifecycle methods
  (`formAssociatedCallback`, `formDisabledCallback`, `formResetCallback`,
  `formStateRestoreCallback`) must exist on the prototype at registration
  time. The browser checks `'methodName' in prototype` once; methods added
  later are never invoked.
- **Per-instance**: `host.attachInternals()` returns the live
  `ElementInternals` and can only be called once per element. After that, the
  user wires `setFormValue` / `setValidity` / ARIA mixins / custom state set
  from inside render.

### Proposal

**Class-time → `defineElement` options.** Forces the options-bag overload
(#5 Tier 2):

```js
defineElement('my-input', ['value'], host => { /* render */ }, {
    formAssociated: true,
    lifecycle: {
        formAssociated:   (host, form) => { /* … */ },
        formDisabled:     (host, disabled) => { /* … */ },
        formReset:        host => { /* … */ },
        formStateRestore: (host, state, mode) => { /* … */ },
    },
});
```

The wrapper sets `static formAssociated` from the option and installs
prototype methods only for the keys actually present in `lifecycle` — the
browser treats absent methods differently from present-but-no-op ones
(saves notification cost).

**Per-instance → `internals()` helper, called inside render.** Mirrors
`props()`: context-aware, valid only inside the render callback, calls
`currentHost.attachInternals()` once and caches the result on a
`WeakMap<host, ElementInternals>` so repeated calls within the same render
return the same instance instead of throwing.

```js
defineElement('my-input', ['value'], host => {
    const i = internals();
    const p = props({ value: '' });
    effect(() => i.setFormValue(p.value));
    return null;
});
```

DEV-mode guard mirrors `props()`: throw the friendly "must be called inside
render" error when `currentHost` is undefined.

### Why not just `host.attachInternals()` directly?
Works for ARIA-mixin and custom-states use cases (which need no class-time
config). Fails for form-association because `static formAssociated` is read
once by `customElements.define` and cannot be patched later. So
`defineElement` has to be involved for that path.

### Open questions
- Should `internals()` always call `attachInternals` (even when not
  form-associated), or only when `formAssociated: true`? Probably always —
  ARIA mixin is a legitimate non-form use case.
- Should there be a separate `ariaInternals()` or similar split, or is
  one helper enough? Likely one helper; ergonomics judged once usage exists.
- How does `disabledFeatures: ['shadow']` (see #8) interact? It blocks
  `internals.shadowRoot` access but not the rest of the API. Document.

### Depends on
#5 Tier 2 (options-bag overload).

---

## 8. Other class-time configuration: lifecycle hooks & static fields

ElementInternals is the largest single user of pre-`customElements.define`
configuration, but it is not alone. The full set of things that must be
decided at define time (and therefore live in the #5 Tier 2 options bag)
is:

### Static fields read once by the registry
- `static observedAttributes` — already covered via the `attrs` arg.
- `static formAssociated` — covered by #7.
- `static disabledFeatures` — opt out of features per-class. Only spec'd
  value today is `'shadow'`: blocks `attachShadow` and ARIA Shadow access
  via `attachInternals().shadowRoot`. Useful as a defensive flag when the
  element is explicitly light-DOM-only.

### Lifecycle callbacks that must exist on the prototype at registration
Browser does `'methodName' in prototype` check at `customElements.define`
time; methods added later are never called.

- `connectedCallback`, `disconnectedCallback`, `attributeChangedCallback` —
  owned by the wrapper today.
- `adoptedCallback(oldDocument, newDocument)` — fires when the element
  moves between documents (iframe, popup, `document.adoptNode`). Not
  currently exposed. Niche but spec-mandated.
- `connectedMoveCallback()` — newer spec hook; fires for
  `Element.moveBefore()` so the element can preserve state across
  DOM relocation instead of being torn down and re-mounted. Worth
  exposing now that it's shipping in Chromium.
- Form-association callbacks (require `formAssociated: true`) — covered
  by #7.

### Class extension
- `base` constructor (`HTMLElement` default vs `HTMLButtonElement` etc.)
  and the `{ extends: 'button' }` third arg to `customElements.define`.
  Covered by #3.

### Proposal

Single `lifecycle` object in the #5 Tier 2 options bag carries all
user-defined callbacks; the wrapper installs each prototype method
conditionally. Static flags are top-level options:

```js
defineElement('my-thing', ['value'], host => /* render */, {
    // static fields
    formAssociated: true,             // #7
    disabledFeatures: ['shadow'],
    // class extension (#3)
    base: HTMLElement,
    // user lifecycle hooks — each one is optional; the wrapper installs
    // the corresponding prototype method only when the key is present
    lifecycle: {
        adopted:          (host, oldDoc, newDoc) => {},
        connectedMove:    host => {},
        formAssociated:   (host, form) => {},
        formDisabled:     (host, disabled) => {},
        formReset:        host => {},
        formStateRestore: (host, state, mode) => {},
    },
});
```

The wrapper-owned `connected`/`disconnected`/`attributeChanged` callbacks
stay internal — exposing user hooks for those would conflict with the
mount/unmount semantics that `render` + `props()` already provide. If a
real use case appears (e.g. teardown that cannot fit into a render-scope
effect cleanup), revisit.

### Open questions
- Should `adopted` and `connectedMove` get first-class API or stay
  rarely-used `lifecycle` entries? Probably the latter — bag stays flat.
- Should there be a `before-define` hook that runs once with the
  constructor, for users who want to patch the prototype directly?
  Unappealing escape hatch; defer until a real ask.

### Depends on
#5 Tier 2 (options-bag overload). All entries here are dormant until
that lands.
