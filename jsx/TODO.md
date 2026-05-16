# @slimlib/jsx v0.1 TODO

Scope: features that close the gap to v1 readiness without bloating the core.
Keep gzip footprint under ~4 KB (currently 3.06 KB with store, 2.70 KB standalone).

## 1. Keyed list renderer

**Goal:** unlock the `swap-rows` and `shuffle-1000` benchmark scenarios; enable typical row/table UIs.

**Shape (proposed):**

```jsx
<For each={() => items()} key={(item) => item.id}>
    {(item, index) => <li>{() => item.label}</li>}
</For>
```

or a function form:

```jsx
{forEach(
    () => items(),
    (item) => item.id,
    (item) => <li>...</li>,
)}
```

**Implementation notes:**

- Insert anchor comment nodes (start/end), same pattern as the existing function-child effect.
- Maintain `Map<key, { node, item, dispose }>` between renders.
- Diff old key list vs new key list using a single-pass LIS-free algorithm (Solid does this; ~80 LOC).
- Each item gets its OWN sub-scope (see #2) so reactive bindings inside an item teardown when the item is removed.
- Decide: keep in core, or ship as `@slimlib/jsx/for` sub-entry to keep base size minimal.

**Open question:** does `key` accept a primitive value too? (`key={(_, i) => i}` is the unkeyed fallback.)

## 2. Sub-scope per dynamic boundary

**Goal:** when a function-child re-runs, dispose effects/cleanups created by the **previous** result before building the new one.

**Today (the bug):**

```jsx
<div>{() => (condition() ? <ComponentA /> : <ComponentB />)}</div>
```

When `condition` flips, the old subtree's `effect()` calls and event listeners are NOT disposed — they leak for the lifetime of the root `render()`.

**Fix:**

- In `appendChild` function-child branch (`src/create-element.ts` ~line 106), wrap the inner build in a sub-`scope()` from `@slimlib/store`.
- Store the dispose-fn at module level (or in a closure), call it before each re-run.
- Also chain the module-level `currentOnDispose` so non-effect cleanups (event listeners, refs) are scoped correctly.
- Same treatment in `insertBefore` and the `<For>` per-item path.

**Caveat:** adds one scope-creation per dynamic boundary. Currently we have ONE scope per `render()`. Likely 50–200 bytes of gzip cost. Worth it.

## 3. Conditional render cleanup

**Goal:** companion to #2 — verify event listeners and ref-callbacks attached inside a conditional sub-tree are properly torn down.

**Verification tests needed:**

- Mount tree with `on:click` inside a conditional, flip the condition, click — should not fire on detached node.
- Ref callback should receive `null` when the node is removed via condition flip.
- Effect bodies inside removed subtree should stop reacting to signal changes.

**Probably falls out of #2** if sub-scope is wired correctly via `currentOnDispose`. Add the tests anyway to lock the contract.

## Stretch (defer past v0.1)

- **Async components** (`type` returns Promise): defer to v0.2.
- **Server-side render to string**: out of scope until DOM API surface is locked.
- **Hydration**: out of scope for v0.x.

## Notes from v0.0 perf work (Nov 2025)

- Text fast-path (mutate `.data` instead of remove + recreate on primitive→primitive
  transitions in a function-child) was prototyped on a separate branch. Measured
  ~10% win on `update-1000`, no measurable effect on `deep-tree-update` because
  per-effect overhead dominates the DOM-op savings at 4096 boundaries. Reverted
  from this branch as the +100 B (gzip) cost wasn't justified by a single bench.
  Will be revisited once `<For>` lands (#1), which replaces per-leaf effects with
  one shared template-update path and shifts where the bottleneck lives.
- Bench numbers in README use median-of-3 chromium runs with
  `mitata.gc('inner')` + `--js-flags=--expose-gc`; single-run numbers can swing
  ±30% on `deep-tree-update`.

## Process / how to start

1. Open feature branch off `jsx`.
2. Implement #2 (sub-scope) first — small change, unblocks #1 and #3.
3. Add tests for #3 (proves #2 works).
4. Implement #1 (keyed list) on top of #2.
5. Benchmark `swap-rows` / `shuffle-1000` against voby/solid/lit-html.
6. Update README, results CSVs, bump to 0.1.0.
