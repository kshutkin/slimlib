# @slimlib/element — design notes

Scratchpad for design ideas and follow-ups before they land in code. Each entry
is a self-contained proposal: rationale, sketch, tradeoffs, open questions.

---

## 1. Back `props` with `state()` instead of per-key signals

### Current
The constructor creates one `signal()` per key in `options.props`, stores them
in `this._p`, and exposes prototype getters/setters that wire `el.foo` to
`this._p.foo()` / `this._p.foo.set(v)`. The `setup({ props })` callback receives
the raw signal map, so authors write `props.foo()` to read and
`props.foo.set(v)` to write.

### Proposal
Replace the per-key signal map with a single `state({ ...defaults })` from
`@slimlib/store`. The host accessors, `attributeChangedCallback`, and the
`setup({ props })` API all read/write through that one reactive object.

```js
import { state } from '@slimlib/store';

class SlimElement extends HTMLElement {
    constructor() {
        super();
        this._props = state({ ...defaults });
        for (const k of propKeys) {
            if (Object.prototype.hasOwnProperty.call(this, k)) {
                const v = this[k];
                delete this[k];
                this[k] = v; // routes through setter -> proxy
            }
        }
    }
    attributeChangedCallback(name, _old, value) {
        this._props[name] = value; // TODO: typed coercion
    }
    connectedCallback() {
        const root = shadow ? this.attachShadow(shadow === true ? { mode: 'open' } : shadow) : this;
        this._dispose = render(() => setup({ element: this, root, props: this._props }), root);
    }
    disconnectedCallback() {
        this._dispose?.();
        this._dispose = undefined;
    }
}
for (const k of propKeys) {
    Object.defineProperty(SlimElement.prototype, k, {
        configurable: true,
        enumerable: true,
        get() { return this._props[k]; },
        set(v) { this._props[k] = v; },
    });
}
```

### Wins
- Author code reads `props.count` (bare value, no `()`); writes `props.count = v`.
- One reactive container per element instead of N signals.
- Deep reactivity for free if a prop is object-shaped (`props.user.name`).
- `attributeChangedCallback` and host accessors collapse to one-liners.

### Tradeoffs / things to watch
- **Handle vs value.** `props.count` is the current value, not a signal handle.
  To pass a reactive read down to a child: `<Child get={() => props.count} />`.
  Document this idiom.
- **Function-valued props.** `state()` wraps any function property on read so
  invocation triggers a PUSH afterwards. Calling `props.onClick(e)` works, but
  `props.onClick === originalFn` is `false` (identity is wrapper-vs-original).
  Note in README; rarely matters in practice.
- **Allocation.** One `Proxy` + `WeakMap` entry per element vs N `signal()`
  objects. Likely negligible but worth a microbench on high-instance scenes
  (adapt the `RowsBench` harness in the playground).
- **Lazy upgrade** still works — the setter goes through the proxy and notifies
  any observers already attached.

### Open questions
- Should we still expose a way to grab a *handle* for a specific prop (e.g. a
  `propHandle(name)` helper that returns `() => props[name]`)? Probably yes
  once a real consumer asks.
- Do we want to allow `setup` to *add* fields to `props` dynamically (the
  `state` proxy is open), or freeze the key set to what's in `defaults`?

---

## 2. Derive class name from tag for nicer devtools / stack traces

### Current
Every element defined via `defineElement` is an instance of a class literally
named `SlimElement`. DevTools and stack traces show `SlimElement` for every
custom element in the app, which is noisy when several are in play.

### Why it isn't a correctness issue
The Custom Elements spec and `customElements.define` don't read
`Ctor.name`. Uniqueness requirements are on:
- The **tag** (must be unique in the registry).
- The **constructor identity** (one constructor cannot register twice).
- `extends HTMLElement` (or an existing element when using built-in extension).

`Ctor.name` only surfaces in:
- DevTools component / element inspector labels.
- Stack traces (`new SlimElement` in errors).
- `el.constructor.name` if user code introspects.

### Proposal
Compute a PascalCase name from the tag at definition time and assign it via the
object-literal computed-key trick so the class's `.name` is correct:

```js
const className = tag.replace(/(^|-)(\w)/g, (_, _d, c) => c.toUpperCase());
// 'my-counter' -> 'MyCounter'
const Ctor = { [className]: class extends HTMLElement { /* … */ } }[className];
```

Two-line change inside `defineElement`. Zero runtime cost beyond one object
allocation per `defineElement` call.

### Tradeoffs
- Cosmetic only — never required.
- Tag → class-name mapping is one-way; if a user later wants to look up an
  element class by name, they should use `customElements.get(tag)`, not
  `.name`. Worth one sentence in the README.

### Open questions
- Should `defineElement` also accept an explicit `className` override (e.g. for
  authors who want the original tag preserved verbatim, or who use multi-word
  tags like `acme-data-grid` and want a different cased name)? Probably defer
  until someone asks.

---

## 3. Support customized built-in elements (extend HTMLButtonElement, etc.)

### Current
`defineElement` hard-codes `class SlimElement extends HTMLElement` — only the
"autonomous" custom element form (`<my-counter>`) is supported.

### Proposal
Accept an optional base constructor and the local tag name to extend:

```js
defineElement({
    tag: 'my-counter',
    base: HTMLButtonElement,  // default: HTMLElement
    extends: 'button',        // required iff base !== HTMLElement
    // … rest
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

### Caveats (the actual cost of supporting this)

1. **Safari does not ship customized built-ins.** WebKit has declined the
   feature for years. Two options: require the `@ungap/custom-elements`
   polyfill in Safari, or document this mode as Chromium + Firefox only.
   Autonomous elements (`extends HTMLElement`) work everywhere — this proposal
   is strictly an *additional* mode.

2. **Shadow DOM is mostly blocked.** Most built-ins (`button`, `input`,
   `select`, `textarea`, etc.) throw on `attachShadow()`. The wrapper must
   either ignore `shadow: true` or error out when `base !== HTMLElement`.
   Customized built-ins render into the element itself (light DOM).

3. **`is=` must be set at element creation time.** Setting
   `el.setAttribute('is', 'my-counter')` after the element exists does NOT
   upgrade it. The browser only honours `is` when:
   - the parser sees the attribute in the initial HTML, or
   - `document.createElement('button', { is: 'my-counter' })` is used.

   The current jsx runtime calls `document.createElement(type)` without the
   options bag (see `jsx/src/core.ts` line ~252). To make
   `<button is="my-counter" />` actually upgrade, the runtime needs to detect
   an `is` prop and pass it via the options arg at creation time. That's a
   small but real runtime change — separate proposal in the jsx package.

4. **TypeScript surface gets a bit fiddly.** `base` and `extends` must agree
   (you can't extend `HTMLButtonElement` and pass `extends: 'div'`). A
   discriminated union of `{ base: HTMLElement } | { base: HTMLButtonElement;
   extends: 'button' } | …` is doable but verbose. Acceptable first cut: type
   `base` as `typeof HTMLElement` and `extends` as `string | undefined`, trust
   the user.

### Open questions
- Do we want this in `@slimlib/element` v1, or punt until a real consumer asks?
  The plumbing in `defineElement` is trivial; the friction is (a) the
  `createElement('button', { is })` change in `@slimlib/jsx`, and (b) deciding
  the Safari policy (polyfill vs unsupported).
- If we ship it, do we also expose an `is`-aware JSX helper (e.g. an
  `elementIs(tag, is, props, children)` factory) for ergonomics, or just rely
  on the runtime detecting an `is` prop?

---

## 4. Attribute reflection and typed attribute coercion

### Current
`options.props` and `options.observedAttributes` are two independent channels
sharing internal storage:
- Setting `el.foo = v` runs the prototype setter, which writes to the internal
  signal/state.
- Changing the `foo` HTML attribute fires `attributeChangedCallback(name, _, v)`,
  which writes the raw string into the same storage.

Two gaps follow from "two channels, no glue":

1. **Type drift.** Attribute path always delivers `string | null`. Prop path
   delivers whatever JS assigns. With both wired to the same storage, the
   value's runtime type depends on which side wrote last. `count="5"` →
   `'5'`; `el.count = 5` → `5`. There's a `// TODO: typed attribute
   coercion` marker in `attributeChangedCallback` for this.
2. **No reflection.** Writing `el.count = 5` does not update the HTML
   attribute, so devtools, CSS attribute selectors, and SSR diffs do not see
   the change.

### Proposal

Introduce a per-prop descriptor (optional — string-only entries in `props`
still work as today) that captures both concerns:

```js
defineElement({
    tag: 'my-counter',
    props: {
        // shorthand: default only — no attribute, no reflection
        ref: null,
        // descriptor form
        count: { value: 0, type: Number, attribute: 'count', reflect: true },
        open:  { value: false, type: Boolean, attribute: 'open', reflect: true },
        label: { value: '',    type: String,  attribute: 'label' }, // observe, don't reflect
    },
    setup: ({ props }) => /* … */,
});
```

Semantics:
- `type: Number | Boolean | String | <fn>` — coercion function applied when an
  attribute value (`string | null`) flows in. Boolean treats presence-as-true /
  absence-as-false (HTML idiom). Custom functions get `(raw: string | null) =>
  T`.
- `attribute: string | false` — name of the observed attribute. Defaults to the
  prop key in kebab-case if `type` is set; `false` opts out (prop-only).
- `reflect: true` — sync prop → attribute on write. Numbers / strings stringify
  via `String(v)`; booleans add/remove the attribute. `null` / `undefined`
  remove the attribute.

`observedAttributes` becomes derived (no longer a separate option) — the
descriptor table is the single source of truth. Existing callers using
`observedAttributes` keep working via a shorthand: top-level
`observedAttributes: ['foo']` is sugar for `props: { foo: { attribute: 'foo' } }`.

### Implementation sketch

- Build a normalized descriptor map at definition time.
- `static get observedAttributes()` returns the list of `attribute` names where
  `attribute !== false`.
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
- Single declarative table replaces two parallel lists (`props` + `observedAttributes`)
  for the common case where they overlap.

### Tradeoffs

- API surface grows. The shorthand `props: { count: 0 }` must keep working,
  so the runtime branches on "is this a descriptor or a bare default?".
  Easy to get wrong when defaults are themselves objects (`{ value: 0 }` *is*
  a descriptor; `{ x: 0, y: 0 }` isn't). Resolution rule: a value is a
  descriptor iff it has at least one of `value`, `type`, `attribute`,
  `reflect` as own keys. Document explicitly; consider requiring an explicit
  `descriptor: true` marker if collisions feel risky.
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
- How does this interact with the `state()`-backed proposal (#1)? Cleanly,
  I think — the descriptor table lives outside the proxy; the setter / attr
  callback just mutate `this._props[key]` after coercion. Worth confirming
  during implementation.

---

## 5. Collapse the API surface (Svelte-ish ergonomics without a compiler)

### Current
`defineElement` takes a single options bag with `tag`, `props`,
`observedAttributes`, `shadow`, `setup`. The `setup` callback receives
`{ element, root, props }`. Inside, reactive reads go through `props.foo()`
and writes through `props.foo.set(v)`.

### Why touch this
The current shape was driven by implementation convenience — one bag, named
fields, a context object passed in. Once `state()` backs `props` (proposal #1),
the runtime no longer needs a separate `props` argument at all, and the
options bag is overkill for the most common case (a tag plus a few defaults
plus a render function).

The bar: get as close to modern Svelte ergonomics as a no-compiler library can.

### Reachable in JS alone

A positional, three-arg form covers ~90 % of definitions:

```js
defineElement('my-counter', { count: 0 }, (host) =>
    <button on:click={() => host.count++}>{() => host.count}</button>
);
```

What changed vs current:
- Positional `(tag, defaults, render)`. No options bag when you don't need one.
- `host` is the element itself. Reading and writing props goes through the
  prototype accessors that `defineElement` already installs.
- With `state()` backing the storage (proposal #1), `host.count++` works
  unmodified — it desugars to `host.count = host.count + 1`, one getter +
  one setter call on the proxy-backed accessors.
- `observedAttributes` derived automatically from the defaults' keys.
  Opt-out (or richer behaviour) happens through the descriptor form from
  proposal #4: `{ count: { value: 0, attribute: false } }`.
- Shadow DOM defaults off (light DOM, autonomous element). To attach a
  shadow root, switch to the options-bag form (Tier 2 below).

This is the closest a non-compiled JS surface can get to Svelte 5 runes. The
only remaining stylistic gap is the `() => host.count` wrapper in JSX
positions — that exists because the JSX runtime evaluates expressions
eagerly at element creation. Without a compiler rewriting reads, the user
has to mark "this read is reactive" with an explicit arrow.

### Tier 2 — keep the options bag for declarative configuration

When proposals #3 (customized built-ins) and #4 (descriptors / reflection)
land, the positional form can't carry their config. Promote to:

```js
defineElement('my-counter', {
    props: {
        count: { value: 0, type: Number, attribute: 'count', reflect: true },
    },
    shadow: { mode: 'open' },
    render: (host) =>
        <button on:click={() => host.count++}>{() => host.count}</button>,
});
```

Same ergonomics inside `render` — the only difference is that the
declaration lives in a config object instead of a positional argument.
Detect "options bag vs defaults object" by sniffing for `render` /
`setup` as a key; falls out naturally without ambiguity.

### Cost analysis (Tier 1 + Tier 2)

- Performance: identical to today modulo the `state()` migration (#1). One
  getter → proxy-get hop per host-prop read, roughly 2–3× a raw signal call
  in microbench but lost in noise at app scale.
- Bundle size: smaller `defineElement` (less options parsing). The state
  proxy is already paid for through `@slimlib/store`.
- Migration: trivial — body of `defineElement` shrinks; callers swap an
  options bag for positional args (or keep the bag when they need
  descriptors).

### Tier 3 — compiler plugin (lowest priority, explicitly out of philosophy alignment)

The remaining `() => host.x` boilerplate is removable by a Rollup/Vite plugin
that rewrites JSX expression positions:

```js
// Source
component('my-counter', { count: 0 }, (host) =>
    <button on:click={() => host.count++}>{host.count}</button>
);

// Emitted
component('my-counter', { count: 0 }, (host) =>
    <button on:click={() => host.count++}>{() => host.count}</button>
);
```

Scope is small — member-read expressions inside JSX children/attributes
get wrapped in arrows. Feasible as a standalone plugin and zero runtime
cost (the rewrite emits exactly what users would write by hand).

**Lowest priority. Misaligned with the library's "explicit over magic"
philosophy.** The whole appeal of slimlib so far is that what you type is
what runs — adding a compiler that silently rewrites expressions trades
that off for a small ergonomic win. Document it as a possibility but do
not implement unless multiple consumers ask. If implemented later, it
must be:
- Optional. Tier 1/2 code must keep working without the plugin.
- Scoped narrowly to JSX member-reads. No bare-identifier rewrites, no
  destructuring magic, no `count++` shorthand for non-host state.
- Behind an explicit opt-in marker (e.g. a specific factory name like
  `component()` instead of `defineElement()`), so users see at the call
  site that the rewrite applies.

### Open questions

- Tier 1 + Tier 2: which `defineElement` signature should be the
  recommended path in the README — positional or options? Probably keep
  both, demo the positional form first.
- Tier 3 plugin: if/when implemented, does it live in `@slimlib/element`
  (close to the API it sugars) or a separate `@slimlib/element-plugin`
  package (so the runtime has no implicit dependency on a build step)?
  Lean toward separate.

---

## 6. Lazy schema declaration inside render — what is reachable, what isn't

### The idea
Move declaration into the render callback. Instead of a schema bag at
definition time, ask the user to declare props (and ideally attributes,
with coercion) from inside the per-instance setup:

```js
defineElement('my-counter', (host) => {
    const { count } = props({
        count: { value: 0, type: Number, attribute: 'count', reflect: true },
    });
    return <button on:click={() => count++}>{() => count}</button>;
});
```

Appeal: schema and use live next to each other; no second pass through the
options bag; one consistent place to read about a prop.

### Why it can't fully work for attributes

`customElements.define(tag, Ctor)` reads several `static` fields **once**
when called and caches them forever. Most relevant:

- `static observedAttributes` — the list is frozen before any instance
  exists. Adding names later does nothing; the browser ignores them.
- `static formAssociated`
- `static disabledFeatures`

`attributeChangedCallback(name, _, value)` is synchronous, but the browser
only fires it for names in the frozen list. So if `props({...})` inside
`render` declares an attribute that wasn't known at `defineElement` time,
the browser never reports changes to it.

### Three ways one could try to work around this

**A. Pre-probe.** Run `render` once with a stub host before
`customElements.define`, capture the schema, then register. Problem:
`render` returns JSX and likely has side effects. Asking the user to make
their render safely re-runnable is fragile.

**B. MutationObserver instead of `attributeChangedCallback`.** Drop
`observedAttributes`, install an MO per instance on `attributes`. Lets
attribute names be discovered per-instance.
- Loses synchrony — `el.setAttribute('foo', '1'); el.foo` no longer
  reflects the new value until the next microtask.
- Doesn't fire for parser-set initial attributes — manual replay needed
  in `connectedCallback`, and again every time a new name is declared.
- One observer per instance (or one global with routing). Allocation cost
  is real at high instance counts.

**C. Stay declarative for attributes only.** Schema for attributes lives
in `defineElement`'s options. `props()` inside `render` is allowed only
for JS-only reactive state (no attribute mirroring). Spec-safe.

### Verdict for attributes
Workaround (B) is the only spec-compatible path, and its synchrony /
allocation / replay costs outweigh the ergonomic win. **Not pursued.**
Attribute declarations stay in the schema at `defineElement` time.

### What is reachable: lazy *prop* (JS-only) declaration

JS properties on an `HTMLElement` aren't constrained by the Custom Elements
registry. We can add accessors, signals, or reactive state any time inside
`render` without the spec complaining. So the spirit of the idea still
works for everything except HTML attribute observation:

```js
defineElement('my-counter', (host) => {
    // Declared at define time (needs attribute observation):
    //   host.count is a prop wired to the 'count' attribute.

    // Declared lazily (JS-only state, no attribute):
    const internal = state({ active: false, hovering: false });
    // Or per-key signals if preferred.

    return /* … uses host.count and internal.active */;
});
```

A `props()` helper *for non-attribute properties* would basically be sugar
over `state()` / `signal()` — useful if it adds genuine ergonomic value,
not worth a new API otherwise.

### A more useful helper that respects the constraint

`bindAttribute(host, name, options)` (or similar) called inside `render`,
which assumes the attribute is **already** in the schema (declared at
`defineElement` time) and returns a fresh reactive binding to its current
value plus a coercion hook:

```js
defineElement('my-counter', {
    props: { count: { value: 0, type: Number, attribute: 'count', reflect: true } },
}, (host) => {
    const count = bindAttribute(host, 'count'); // sugar; spec-safe because schema is declared
    return <button on:click={() => count.set(count() + 1)}>{count}</button>;
});
```

This pulls the *use* of an attribute closer to the render code without
violating the registry's one-shot schema read. Worth considering once
proposals #1 and #4 settle — until then `host.count` from the prototype
accessor already does the job.

### Open questions

- If a `props()` helper for JS-only state lands, does it overlap enough
  with `state()` from `@slimlib/store` to confuse users? Probably yes —
  default to plain `state()` and only add `props()` if it earns its keep.
- Is `bindAttribute` worth shipping as a primitive, or is the prototype
  accessor enough for every realistic case? Likely the accessor suffices.
