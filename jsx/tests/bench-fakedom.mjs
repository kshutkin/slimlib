// @ts-nocheck
/**
 * Low-variance fake-DOM benchmark for jsx/src/core.js.
 *
 * Uses tests/fake-dom.mjs so leaf DOM ops are O(1) C-free linked-list
 * pointer twiddles. This isolates the renderer's JS overhead from
 * Chromium/happy-dom layout noise.
 *
 * Harness: ITERS inner iterations per sample × SAMPLES samples (after
 * WARMUP discarded samples). Reports median p50 plus p25/p75 spread.
 */

import './fake-dom.mjs';

const { createElement, render } = await import('../src/index.js');
const { forEach } = await import('../src/for-each.js');
const { signal, setScheduler, flushEffects } = await import('@slimlib/store');

// Synchronous scheduler: each signal write -> immediate effect flush.
setScheduler(fn => fn());

// ----- harness --------------------------------------------------------------

const ITERS = Number(process.env.BENCH_ITERS) || 200;
const SAMPLES = Number(process.env.BENCH_SAMPLES) || 25;
const WARMUP = Number(process.env.BENCH_WARMUP) || 5;

const now = () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Number(process.hrtime.bigint()) / 1e6;

function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function runWorkload(name, body) {
    // Warmup
    for (let s = 0; s < WARMUP; s++) {
        for (let i = 0; i < ITERS; i++) body();
    }
    const samples = [];
    for (let s = 0; s < SAMPLES; s++) {
        const t0 = now();
        for (let i = 0; i < ITERS; i++) body();
        const dt = now() - t0;
        samples.push(dt / ITERS); // ms per op
    }
    samples.sort((a, b) => a - b);
    const p25 = quantile(samples, 0.25);
    const p50 = quantile(samples, 0.5);
    const p75 = quantile(samples, 0.75);
    const spread = ((p75 - p25) / p50) * 100;
    return { name, p25, p50, p75, spread };
}

// ----- workloads ------------------------------------------------------------

const h = createElement;

// W1: mount 1000 <div>item N</div> into a fresh container, then dispose.
function w1() {
    const container = document.createElement('div');
    const dispose = render(
        () =>
            h(
                'div',
                null,
                ...Array.from({ length: 1000 }, (_, i) => h('div', null, `item ${i}`))
            ),
        container
    );
    flushEffects();
    dispose();
}

// W2: deep tree 4 levels × branching 8 = 4096 leaves.
function buildDeep(depth) {
    if (depth === 0) return h('span', null, 'leaf');
    const kids = new Array(8);
    for (let i = 0; i < 8; i++) kids[i] = buildDeep(depth - 1);
    return h('div', null, ...kids);
}
function w2() {
    const container = document.createElement('div');
    const dispose = render(() => buildDeep(4), container);
    flushEffects();
    dispose();
}

// W3: reactive-update — signal-driven text, mount once, then set 1000 times.
function w3factory() {
    const container = document.createElement('div');
    const sig = signal(0);
    const dispose = render(() => h('div', null, sig), container);
    flushEffects();
    return { sig, dispose };
}
let w3state;
function w3() {
    for (let i = 0; i < 1000; i++) {
        w3state.sig.set(i + 1);
    }
}

// W4: prop-update — signal-driven className.
function w4factory() {
    const container = document.createElement('div');
    const sig = signal('a');
    const dispose = render(() => h('div', { className: sig }, 'x'), container);
    flushEffects();
    return { sig, dispose };
}
let w4state;
function w4() {
    for (let i = 0; i < 1000; i++) {
        w4state.sig.set(i & 1 ? 'a' : 'b');
    }
}

// W5: forEach-mount — 100 items each containing {() => item().label}.
const W5_ITEMS = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `n${i}` }));
function w5() {
    const container = document.createElement('div');
    const items = signal(W5_ITEMS);
    const dispose = render(
        () =>
            h(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => h('li', null, () => item().label)
                )
            ),
        container
    );
    flushEffects();
    dispose();
}

// W6: forEach-shuffle — mount, then signal.set with shuffled order.
function makeShuffled(arr, seed) {
    const out = arr.slice();
    let s = seed | 0;
    for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) | 0;
        const j = Math.abs(s) % (i + 1);
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
    }
    return out;
}
const W6_SHUFFLES = [
    makeShuffled(W5_ITEMS, 1),
    makeShuffled(W5_ITEMS, 2),
    makeShuffled(W5_ITEMS, 3),
    makeShuffled(W5_ITEMS, 4),
];
function w6factory() {
    const container = document.createElement('div');
    const items = signal(W5_ITEMS);
    const dispose = render(
        () =>
            h(
                'ul',
                null,
                forEach(
                    () => items(),
                    item => item.id,
                    item => h('li', null, () => item().label)
                )
            ),
        container
    );
    flushEffects();
    return { items, dispose };
}
let w6state;
let w6tick = 0;
function w6() {
    w6state.items.set(W6_SHUFFLES[w6tick++ & 3]);
}

// ----- driver ---------------------------------------------------------------

const results = [];

results.push(runWorkload('W1 create-1000', w1));
results.push(runWorkload('W2 create-deep-4x8', w2));

w3state = w3factory();
results.push(runWorkload('W3 reactive-text-1000', w3));
w3state.dispose();

w4state = w4factory();
results.push(runWorkload('W4 prop-update-1000', w4));
w4state.dispose();

results.push(runWorkload('W5 forEach-mount-100', w5));

w6state = w6factory();
results.push(runWorkload('W6 forEach-shuffle-100', w6));
w6state.dispose();

// ----- report ---------------------------------------------------------------

const nameW = Math.max(...results.map(r => r.name.length));
console.log(
    `${'workload'.padEnd(nameW)}  ${'p25 (ms)'.padStart(12)}  ${'p50 (ms)'.padStart(12)}  ${'p75 (ms)'.padStart(12)}  ${'spread'.padStart(8)}`
);
console.log('-'.repeat(nameW + 2 + 12 + 2 + 12 + 2 + 12 + 2 + 8));
for (const r of results) {
    console.log(
        `${r.name.padEnd(nameW)}  ${r.p25.toFixed(4).padStart(12)}  ${r.p50.toFixed(4).padStart(12)}  ${r.p75.toFixed(4).padStart(12)}  ${r.spread.toFixed(2).padStart(7)}%`
    );
}
// JSON tail for easy parsing.
console.log('\nJSON ' + JSON.stringify(results.map(r => ({ name: r.name, p50: r.p50, p25: r.p25, p75: r.p75 }))));
