/**
 * V8 Deoptimization Check Script
 *
 * Exercises the store implementation under V8 tracing flags to detect
 * deoptimizations, hidden class transitions, and JIT bailouts.
 *
 * Usage:
 *   npm run deopt                                         # Quick deopt summary
 *   npm run deopt:full                                    # Full trace-opt + trace-deopt
 *   npm run deopt:opt                                     # Show what gets optimized
 *   node --trace-deopt tests/deopt-check.mjs              # Raw deopt trace
 *   node --trace-deopt tests/deopt-check.mjs 2>&1 | node tests/deopt-check.mjs --parse
 *   node --trace-deopt --trace-opt tests/deopt-check.mjs  # Both traces
 *
 * Structured report mode (pipe trace output):
 *   node --trace-deopt tests/deopt-check.mjs 2>&1 | node tests/deopt-check.mjs --parse
 */

import { computed, effect, flushEffects, signal, state, untracked, unwrapValue } from '../dist/index.mjs';

// ── Parse mode: read stdin and produce structured report ──────────────
if (process.argv.includes('--parse')) {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        input += chunk;
    }
    const lines = input.split('\n');
    const deopts = [];
    const markings = [];
    for (const line of lines) {
        const bailout = line.match(
            /\[bailout \(kind: ([^,]+), reason: ([^)]+)\).*deoptimizing.*?<JSFunction\s+(\S+).*opt id (\d+), bytecode offset (\d+)/
        );
        if (bailout) {
            deopts.push({
                kind: bailout[1],
                reason: bailout[2],
                fn: bailout[3],
                optId: Number(bailout[4]),
                offset: Number(bailout[5]),
            });
            continue;
        }
        const marking = line.match(/\[marking dependent code.*?<SharedFunctionInfo (\S+)>.*reason: ([^\]]+)\]/);
        if (marking) {
            markings.push({ fn: marking[1], reason: marking[2] });
        }
    }

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║           V8 DEOPTIMIZATION REPORT — @slimlib/store         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Summary by reason
    const byReason = new Map();
    for (const d of deopts) {
        const key = d.reason;
        if (!byReason.has(key)) byReason.set(key, []);
        byReason.get(key).push(d);
    }
    console.log(`Total deoptimizations: ${deopts.length}`);
    console.log(`Total marking events:  ${markings.length}\n`);

    console.log('── Deopts by reason ─────────────────────────────────────────');
    for (const [reason, items] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const fns = [...new Set(items.map(i => i.fn))].join(', ');
        console.log(`  [${items.length}x] ${reason}`);
        console.log(`       in: ${fns}`);
    }

    // Summary by function
    const byFn = new Map();
    for (const d of deopts) {
        if (!byFn.has(d.fn)) byFn.set(d.fn, []);
        byFn.get(d.fn).push(d);
    }
    console.log('\n── Deopts by function ───────────────────────────────────────');
    for (const [fn, items] of [...byFn.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const reasons = [...new Set(items.map(i => i.reason))].join('; ');
        console.log(`  ${fn} (${items.length}x): ${reasons}`);
    }

    if (markings.length > 0) {
        console.log('\n── Dependent code invalidations ─────────────────────────────');
        for (const m of markings) {
            console.log(`  ${m.fn}: ${m.reason}`);
        }
    }

    // Known-good: filter out benign/framework deopts
    const benign = new Set(['prepare for on stack replacement (OSR)', '(unknown)']);
    const actionable = deopts.filter(d => !benign.has(d.reason));
    const actionableByFn = new Map();
    for (const d of actionable) {
        if (!actionableByFn.has(d.fn)) actionableByFn.set(d.fn, []);
        actionableByFn.get(d.fn).push(d);
    }
    console.log(`\n── Actionable deopts (excl. OSR / unknown): ${actionable.length} ──────────`);
    for (const [fn, items] of [...actionableByFn.entries()].sort((a, b) => b[1].length - a[1].length)) {
        for (const d of items) {
            console.log(`  ${fn} @ bc:${d.offset}  [${d.kind}] ${d.reason}`);
        }
    }

    console.log('\n── Diagnosis hints ──────────────────────────────────────────');
    if (byReason.has('wrong map')) {
        console.log('  ⚠  "wrong map" — Objects at IC sites have varying hidden classes.');
        console.log('     Common causes: polymorphic property access on different object shapes,');
        console.log('     proxy targets with different structures, or Map/WeakMap lookups on varied keys.');
    }
    if (byReason.has('wrong name')) {
        console.log('  ⚠  "wrong name" — Inline cache expected a different property name.');
        console.log('     Likely caused by Proxy handler traps receiving different property names;');
        console.log('     V8 monomorphically caches the first property name it sees.');
    }
    if (byReason.has('wrong call target')) {
        console.log('  ⚠  "wrong call target" — Different closures at the same call site.');
        console.log('     This happens when functions are created per-instance (closures in factories).');
        console.log('     Consider hoisting functions or using shared prototypes.');
    }
    if (byReason.has('wrong feedback cell')) {
        console.log('  ⚠  "wrong feedback cell" — Feedback vector became invalid between tiers.');
        console.log('     Usually caused by re-optimization after feedback was cleared. Benign in most cases.');
    }
    const fieldChanges = [...byReason.keys()].filter(k => k.includes('field type'));
    if (fieldChanges.length > 0 || markings.some(m => m.reason.includes('field type'))) {
        console.log('  ⚠  "dependent field type changed" — V8 field representation was generalized.');
        console.log('     This happens when object fields store values of different representations');
        console.log('     (e.g., Smi → HeapObject). Ensure fields are initialized with consistent types.');
    }
    if ([...byReason.keys()].some(k => k.includes('binary operation'))) {
        console.log('  ⚠  "Insufficient type feedback for binary operation" — Bitwise/arithmetic ops');
        console.log("     on values whose types V8 hasn't profiled enough. May need more warm-up iterations.");
    }
    if ([...byReason.keys()].some(k => k.includes('generic named access'))) {
        console.log('  ⚠  "Insufficient type feedback for generic named access" — Named property loads');
        console.log('     that are megamorphic (too many different hidden classes at the same IC site).');
    }
    if ([...byReason.keys()].some(k => k.includes('generic keyed access'))) {
        console.log('  ⚠  "Insufficient type feedback for generic keyed access" — Symbol/computed');
        console.log('     property access is megamorphic. Symbol-keyed access on varied object shapes.');
    }
    if ([...byReason.keys()].some(k => k.includes('not a Number'))) {
        console.log('  ⚠  "not a Number" — Expected Smi/HeapNumber but got a different type.');
        console.log('     Check arithmetic operations — a field may sometimes be undefined or non-numeric.');
    }

    console.log('');
    process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Run fn enough times to trigger JIT compilation */
const hotLoop = (fn, iterations = 100_000) => {
    for (let i = 0; i < iterations; i++) {
        fn(i);
    }
};

/** Warm-up + timed benchmark */
const benchmark = (name, fn, iterations = 100_000) => {
    hotLoop(fn, 10_000); // warm JIT
    const start = performance.now();
    hotLoop(fn, iterations);
    const end = performance.now();
    const totalMs = end - start;
    console.log(`  ${name}: ${totalMs.toFixed(3)}ms — ${((totalMs / iterations) * 1_000).toFixed(4)}µs/op`);
};

// ══════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ══════════════════════════════════════════════════════════════════════

console.log('=== V8 Deoptimization Check for @slimlib/store ===\n');

// ── 1. Signal monomorphic fast-path ───────────────────────────────────
console.log('── 1. Signal read/write (monomorphic) ──');
{
    const count = signal(0);
    benchmark('signal read', () => count());
    benchmark('signal write', i => count.set(i));
}
console.log();

// ── 2. Signal with tracked dependency ─────────────────────────────────
console.log('── 2. Signal read inside computed (tracked) ──');
{
    const a = signal(1);
    const b = signal(2);
    const sum = computed(() => a() + b());
    sum(); // init
    benchmark('computed read (cached)', () => sum());
    benchmark('computed read (invalidated)', () => {
        a.set(Math.random());
        return sum();
    });
}
console.log();

// ── 3. Computed chain (tests runWithTracking, checkComputedSources) ──
console.log('── 3. Computed chain (4 deep) ──');
{
    const base = signal(1);
    const c1 = computed(() => base() * 2);
    const c2 = computed(() => c1() + 1);
    const c3 = computed(() => c2() * 3);
    const c4 = computed(() => c3() - 5);
    c4();
    benchmark('chain read (cached)', () => c4());
    benchmark('chain read (invalidated)', () => {
        base.set(Math.random());
        return c4();
    });
}
console.log();

// ── 4. Diamond dependency (tests markNeedsCheck fan-out) ─────────────
console.log('── 4. Diamond dependency pattern ──');
{
    const src = signal(1);
    const left = computed(() => src() * 2);
    const right = computed(() => src() * 3);
    const diamond = computed(() => left() + right());
    diamond();
    benchmark('diamond cached', () => diamond());
    benchmark('diamond invalidated', () => {
        src.set(Math.random());
        return diamond();
    });
}
console.log();

// ── 5. Effect lifecycle (batchedAdd, scheduleFlush, clearSources) ────
console.log('── 5. Effect create / flush / dispose ──');
{
    const count = signal(0);
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const dispose = effect(() => {
            count();
        });
        flushEffects();
        dispose();
    }
    const ms = performance.now() - start;
    console.log(`  create+flush+dispose: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op`);
}
console.log();

// ── 6. Effect with multiple deps (tests batched scheduling) ──────────
console.log('── 6. Effect with 4 deps (batch scheduling) ──');
{
    const a = signal(0),
        b = signal(0),
        c = signal(0),
        d = signal(0);
    let runs = 0;
    const dispose = effect(() => {
        a() + b() + c() + d();
        runs++;
    });
    flushEffects();
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        a.set(i);
        b.set(i);
        c.set(i);
        d.set(i);
        flushEffects();
    }
    const ms = performance.now() - start;
    dispose();
    console.log(`  4-dep effect: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op (${runs} runs)`);
}
console.log();

// ── 7. State basic read/write (Proxy get/set traps) ──────────────────
console.log('── 7. State read/write (monomorphic shape) ──');
{
    const store = state({ count: 0, name: 'test' });
    benchmark('read number', () => store.count);
    benchmark('read string', () => store.name);
    benchmark('write number', i => {
        store.count = i;
    });
    benchmark('write string', i => {
        store.name = `test${i}`;
    });
}
console.log();

// ── 8. Nested state (createProxy recursion) ──────────────────────────
console.log('── 8. Nested state access ──');
{
    const store = state({ user: { profile: { name: 'John', age: 30 } } });
    benchmark('nested read', () => store.user.profile.name);
    benchmark('nested write', i => {
        store.user.profile.age = i;
    });
}
console.log();

// ── 9. State arrays (method wrapping, push notifications) ────────────
console.log('── 9. State array operations ──');
{
    const store = state({ items: [1, 2, 3, 4, 5] });
    benchmark('index read', i => store.items[i % 5]);
    benchmark('index write', i => {
        store.items[i % 5] = i;
    });
    benchmark('map', () => store.items.map(x => x * 2));
    benchmark('filter', () => store.items.filter(x => x > 2));
    benchmark('reduce', () => store.items.reduce((a, b) => a + b, 0));
    benchmark('push+truncate', i => {
        store.items.push(i);
        if (store.items.length > 100) store.items.length = 5;
    });
}
console.log();

// ── 10. Polymorphic state shapes (proxy trap "wrong map" stress) ─────
console.log('── 10. Polymorphic state shapes (multi-shape proxy targets) ──');
{
    const stores = [
        state({ value: 1 }),
        state({ value: 'str' }),
        state({ value: true }),
        state({ value: null }),
        state({ value: { nested: 1 } }),
    ];
    benchmark('poly read', i => stores[i % stores.length].value);
}
console.log();

// ── 11. Dynamic property addition on state ───────────────────────────
console.log('── 11. Dynamic property addition (hidden class transitions) ──');
{
    const addProps = () => {
        const s = state({});
        s.a = 1;
        s.b = 2;
        s.c = 3;
        return s.a + s.b + s.c;
    };
    benchmark('add 3 props', addProps, 1_000);
}
console.log();

// ── 12. Mixed-type computed (return-type polymorphism) ────────────────
console.log('── 12. Computed returning mixed types ──');
{
    const flag = signal(true);
    const num = signal(42);
    const str = signal('hello');
    const mixed = computed(() => (flag() ? num() : str()));
    benchmark('mixed-type computed', i => {
        flag.set(i % 2 === 0);
        return mixed();
    });
}
console.log();

// ── 13. Large state object (megamorphic keyed access) ────────────────
console.log('── 13. Large state object (100 props) ──');
{
    const big = state(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i])));
    benchmark('random prop read', i => big[`p${i % 100}`]);
    benchmark('random prop write', i => {
        big[`p${i % 100}`] = i;
    });
}
console.log();

// ── 14. unwrapValue stress (symbol-keyed access on varied shapes) ────
console.log('── 14. unwrapValue (symbol keyed access) ──');
{
    const s1 = state({ x: 1 });
    const s2 = state({ y: 'hello' });
    const plain1 = { x: 1 };
    const plain2 = { y: 'hello' };
    const targets = [s1, s2, plain1, plain2, 42, 'str', null, undefined, true];
    benchmark('unwrapValue mixed', i => unwrapValue(targets[i % targets.length]));
}
console.log();

// ── 15. untracked reads (context switching stress) ───────────────────
console.log('── 15. untracked() context switching ──');
{
    const a = signal(10);
    const c = computed(() => {
        const v = a();
        const u = untracked(() => a());
        return v + u;
    });
    c();
    benchmark('computed with untracked', () => {
        a.set(Math.random());
        return c();
    });
}
console.log();

// ── 16. createSourceEntry field representation stress ────────────────
//    Tests that state entries (node=undefined, getter=fn, storedValue=varies)
//    and computed entries (node=obj, getter=undefined, storedValue=undefined)
//    share the same hidden class through the factory.
console.log('── 16. Source entry hidden class monomorphism ──');
{
    const s = signal(0);
    const s2 = signal('hello');
    const c1 = computed(() => s() + 1);
    const c2 = computed(() => s2() + '!');
    // Interleave state + computed source creation
    const interleaved = computed(() => s() + c1() + c2().length + s2().length);
    interleaved();
    benchmark('interleaved deps (state+computed)', () => {
        s.set(Math.random());
        s2.set(String(Math.random()));
        return interleaved();
    });
}
console.log();

// ── 17. Effect + computed interop (different node types through same paths) ──
console.log('── 17. Effect + computed interop ──');
{
    const a = signal(0);
    const c = computed(() => a() * 2);
    // biome-ignore lint/correctness/noUnusedVariables: used next line
    let effectVal = 0;
    const dispose = effect(() => {
        effectVal = c();
    });
    flushEffects();

    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        a.set(i);
        flushEffects();
    }
    const ms = performance.now() - start;
    dispose();
    console.log(`  effect reading computed: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op`);
}
console.log();

// ── 18. markDependents / markNeedsCheck (DepsSet iteration) ──────────
console.log('── 18. Fan-out: signal → many computeds ──');
{
    const src = signal(0);
    const computeds = Array.from({ length: 50 }, (_, i) => computed(() => src() + i));
    // Init all
    for (const c of computeds) c();
    benchmark('fan-out invalidation (50 deps)', i => {
        src.set(i);
        // Read one to trigger pull
        return computeds[i % 50]();
    });
}
console.log();

// ── 19. State read inside effect (trackStateDependency hot path) ─────
console.log('── 19. State inside effect (trackStateDependency stress) ──');
{
    const store = state({ x: 0, y: 0 });
    let runs = 0;
    const dispose = effect(() => {
        store.x + store.y;
        runs++;
    });
    flushEffects();
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        store.x = i;
        store.y = i;
        flushEffects();
    }
    const ms = performance.now() - start;
    dispose();
    console.log(`  state in effect: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op (${runs} runs)`);
}
console.log();

// ── 20. notifyPropertyDependents with varied targets ─────────────────
console.log('── 20. notifyPropertyDependents (varied targets) ──');
{
    const s1 = state({ val: 0 });
    const s2 = state({ val: 0, extra: '' });
    const s3 = state({ val: 0, extra: '', more: false });
    const c = computed(() => s1.val + s2.val + s3.val);
    c();
    benchmark('notify varied shapes', i => {
        s1.val = i;
        s2.val = i;
        s3.val = i;
        return c();
    });
}
console.log();

// ── 21. Computed equality check path ─────────────────────────────────
console.log('── 21. Computed equality cutoff (value unchanged) ──');
{
    const a = signal(0);
    const clamped = computed(() => Math.min(a(), 10));
    const downstream = computed(() => clamped() + 1);
    downstream();
    // After warm-up, a() > 10 so clamped() always returns 10
    // Tests the equality-cutoff path in computedRead
    a.set(100);
    downstream();
    benchmark('equality cutoff', i => {
        a.set(100 + i); // clamped still 10
        return downstream();
    });
}
console.log();

// ── 22. Computed error caching path ──────────────────────────────────
console.log('── 22. Computed error caching ──');
{
    const flag = signal(true);
    const mayThrow = computed(() => {
        if (flag()) throw new Error('boom');
        return 42;
    });
    // Exercise both paths
    benchmark(
        'error computed read',
        i => {
            flag.set(i % 3 === 0);
            try {
                return mayThrow();
            } catch {
                return -1;
            }
        },
        10_000
    );
}
console.log();

// ── 23. Scope creation and disposal ──────────────────────────────────
console.log('── 23. Scope lifecycle ──');
{
    const { scope } = await import('../dist/index.mjs');
    const iterations = 5_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const s = scope(onDispose => {
            const a = signal(i);
            const c = computed(() => a() + 1);
            effect(() => {
                c();
            });
            onDispose(() => {});
        });
        flushEffects();
        s(); // dispose
    }
    const ms = performance.now() - start;
    console.log(`  scope create+dispose: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op`);
}
console.log();

// ── 24. clearSources (dependency cleanup) ────────────────────────────
console.log('── 24. clearSources (conditional deps) ──');
{
    const flag = signal(true);
    const a = signal(1);
    const b = signal(2);
    // Alternating dependency set triggers clearSources
    const cond = computed(() => (flag() ? a() : b()));
    cond();
    benchmark('conditional deps', i => {
        flag.set(i % 2 === 0);
        return cond();
    });
}
console.log();

// ── 25. makeLive / makeNonLive (live graph transitions) ──────────────
console.log('── 25. Live graph transitions ──');
{
    const src = signal(0);
    const mid = computed(() => src() + 1);
    const iterations = 2_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        // Creating an effect makes mid "live"
        const dispose = effect(() => {
            mid();
        });
        flushEffects();
        dispose(); // makes mid "non-live"
    }
    const ms = performance.now() - start;
    console.log(`  live/non-live toggle: ${ms.toFixed(3)}ms — ${((ms / iterations) * 1_000).toFixed(4)}µs/op`);
}
console.log();

// ══════════════════════════════════════════════════════════════════════
console.log('=== Deoptimization check complete ===\n');
console.log('To generate a structured report, run:');
console.log('  node --trace-deopt tests/deopt-check.mjs 2>&1 | node tests/deopt-check.mjs --parse');
console.log('\nOther useful commands:');
console.log('  node --trace-deopt tests/deopt-check.mjs 2>&1 | grep -i "deoptimiz"');
console.log('  node --trace-opt tests/deopt-check.mjs 2>&1 | grep -i "optimiz"');
console.log('  node --trace-representation tests/deopt-check.mjs');
