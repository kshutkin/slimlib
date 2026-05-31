// @ts-nocheck
/**
 * Deoptimization probe. Runs the same workloads as bench-fakedom.mjs but
 * against the built dist/ bundle and prints any V8 deopts whose stack frames
 * land in our code (core.mjs / index.mjs / for-each.mjs / jsx-runtime.mjs).
 *
 * Run via: node --trace-deopt tests/bench-deopt.mjs 2>&1
 * Or:      pnpm bench:deopt
 */
import './fake-dom.mjs';

const { createElement, render } = await import('../dist/index.mjs');
const { forEach } = await import('../dist/for-each.mjs');
const { signal, setScheduler } = await import('@slimlib/store');

setScheduler(fn => fn());

const ITERS = Number(process.env.BENCH_ITERS) || 200;
const SAMPLES = Number(process.env.BENCH_SAMPLES) || 25;
const WARMUP = Number(process.env.BENCH_WARMUP) || 5;

function makeContainer() {
    const c = document.createElement('div');
    document.body.appendChild(c);
    return c;
}

function listWorkload(seed) {
    const data = signal(Array.from({ length: 100 }, (_, i) => ({ id: i, v: seed + i })));
    const container = makeContainer();
    const dispose = render(
        () => createElement(
            'ul',
            null,
            forEach(
                () => data(),
                (item) => item.id,
                (item) => createElement('li', null, () => String(item().v)),
            ),
        ),
        container,
    );
    // shuffle
    const shuffled = data().slice().sort(() => Math.random() - 0.5);
    data.set(shuffled);
    // prepend
    data.set([{ id: 1000 + seed, v: -1 }, ...data()]);
    // append
    data.set([...data(), { id: 2000 + seed, v: -2 }]);
    // remove middle
    data.set(data().filter((_, i) => i % 7 !== 0));
    // update values (tests cached $_item short-circuit)
    data.set(data().map(x => ({ ...x, v: x.v + 1 })));
    dispose();
    if (container.parentNode) container.parentNode.removeChild(container);
}

function elementWorkload(seed) {
    const container = makeContainer();
    const dispose = render(
        () => createElement(
            'div',
            { class: `box-${seed}`, style: { color: 'red' } },
            createElement('span', { id: `s${seed}` }, () => String(seed)),
            createElement('input', { type: 'text', value: String(seed), 'on:click': () => {} }),
        ),
        container,
    );
    dispose();
    if (container.parentNode) container.parentNode.removeChild(container);
}

// Warmup -> trigger tiering up to Maglev/Turbofan.
for (let i = 0; i < WARMUP * ITERS; i++) {
    listWorkload(i);
    elementWorkload(i);
}

// Measured run -> any new deopts here are reported by --trace-deopt.
for (let s = 0; s < SAMPLES; s++) {
    for (let i = 0; i < ITERS; i++) {
        listWorkload(s * ITERS + i);
        elementWorkload(s * ITERS + i);
    }
}

console.log('done');
