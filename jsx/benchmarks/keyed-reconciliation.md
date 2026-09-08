# Keyed reconciliation measurements

The renderer now moves only the rows outside an already ordered subsequence.
It first trims settled ends and handles end-to-end moves directly. A mixed middle
uses a longest increasing subsequence (LIS). The prior entry array supplies ordering
information without another Node-to-index map in the normal case; this order is
validated against the live DOM, with a scan fallback for consumer moves/detachment.
Insertions whose surviving rows remain ordered skip the LIS calculation.

This work starts from main (`495c0fe7703d4bb3784e90a05ad4a3c60b94ec6c`). The scope
optimization on `codex/scope-performance` is **not** included.

## DOM operations

One-way changes to 1,000 existing rows, measured separately from timings:

| Change | Original moves | Current moves |
| --- | ---: | ---: |
| Last row to front | 999 | 1 |
| First row to end | 1 | 1 |
| Swap indices 1 and 998 | 997 | 2 |
| Seeded shuffle | 991 | 941 |
| Reverse | 999 | 999 |
| Append / prepend | 0 | 0 |

Append/prepend each insert one new node. Identity is preserved for surviving rows.
All 120 permutations of five rows are tested against an independent quadratic
minimum-move oracle. Tests also cover mixed insertion/removal, reactive indices,
consumer DOM changes, focus in an unaffected row, and custom-element callbacks
clearing the anchors during a move.

## Browser timings

Apple M1, Chromium 148.0.7778.96. Production-mode minified esbuild bundles vary
only `jsx/src/core.ts`; both use the same main-branch store source. Each variant
has its own page, with cross-origin isolation for high-resolution timers.

There are three warmup batches and 15 measured batches per case. Each batch
performs 100 updates for 1,000 rows, or 500 updates for 10 rows. Variant order
alternates, and GC runs before each batch, outside timing. GC during a batch
remains included. Setup, validation, and disposal happen outside timing, and each
batch removes its container and disposes its render scope.

**Timings alternate between the base and changed arrays**, so rotation timings
include both directions. Default scheduling awaits both microtask stages (list
reconciliation and any row effects); sync scheduling runs immediately. Checks
verify the completed DOM order, text, and surviving node identities.

Median milliseconds per update, 1,000 rows:

| Case | Original default | Current default | Original sync | Current sync |
| --- | ---: | ---: | ---: | ---: |
| Rotate right / restore | 0.28050 | 0.09725 | 0.29775 | 0.10215 |
| Swap distant rows | 0.43015 | 0.09775 | 0.46195 | 0.09870 |
| Shuffle / restore | 0.45625 | 0.48645 | 0.47650 | 0.50685 |
| Reverse | 0.43660 | 0.41950 | 0.46530 | 0.45300 |
| Append / remove | 0.10740 | 0.10070 | 0.11655 | 0.11140 |
| Prepend / remove | 0.11040 | 0.10225 | 0.12375 | 0.11655 |
| Replace tail value / restore | 0.10640 | 0.10085 | 0.11925 | 0.11240 |
| Remove every third row / restore | 0.41785 | 0.47830 | 0.53380 | 0.50880 |

The large swap is approximately **77–79% faster**, and the rotation cycle is
**65–66% faster**. For 10 rows, swaps improve roughly 37–41% and rotations
32–38%; those differences are only about 1–2 microseconds per update.

Fewer DOM moves do not guarantee lower time for every workload. Random shuffles
save only 50 moves here, and LIS bookkeeping makes them about **6–7% slower**.
Small reversals also regress about 5–6%. Bulk removal/restoration is mixed:
14.5% slower with default scheduling and 4.7% faster synchronously in this run.
These throughput measurements exclude layout/paint and do not establish an FPS
improvement or predict all custom-element lifecycle costs.

An initial generic LIS implementation reduced the same moves but paid for a
Node-to-index map on every unresolved middle. It regressed shuffle/reverse cases
by about 9–14% and bulk removal/restoration by about 22%. Direct end moves and
reuse of the previous entry array improved those tradeoffs substantially.

## Size and storage

The isolated `for-each` entry bundled with its dependencies grows from **7,080 to
8,028 minified bytes**, or **3,129 to 3,516 gzip bytes** (+387). This is a consistent
before/after esbuild comparison, not the standalone size of the sub-entry stub or
the incremental cost in every application bundle.

One previous entry array is retained per live list. Reordering uses temporary
order/predecessor arrays, and the consumer-DOM fallback also creates a temporary
Map. No extra metadata is attached to consumer DOM nodes. Ordinary reconciliation
remains linear; the mixed reorder search is O(n log n), with O(n) auxiliary space.

## Reproduce

From `jsx/`:

```sh
node tests/bench-keyed.mjs 495c0fe7703d4bb3784e90a05ad4a3c60b94ec6c 15
```

The harness checks operation counts independently of timed batches and runs both
schedulers with 10 and 1,000 rows. `KEYED_BENCH_OUTPUT` selects the output path
(default `/tmp/slimlib-keyed-benchmark.json`).

[Recorded results](./keyed-results.json) contain all raw samples, operation counts,
sizes, and the current source snapshot. Validation also includes the Chromium JSX test suite,
TypeScript checks, and a package build.
