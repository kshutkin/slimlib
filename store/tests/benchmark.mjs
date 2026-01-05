/**
 * Benchmark runner based on https://github.com/milomg/js-reactivity-benchmark
 * Run with: node tests/benchmark.mjs
 */

import { computed, effect, flush, signal } from '../src/index.js';

// Helper class for counting
class Counter {
    count = 0;
}

// Helper function for simulating heavy computation
function busy() {
    let a = 0;
    for (let i = 0; i < 100; i++) {
        a++;
    }
}

// Pseudo-random number generator for reproducible tests
function pseudoRandom(seed = 0) {
    return () => {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// Fibonacci for mol bench
function fib(n) {
    if (n < 2) return 1;
    return fib(n - 1) + fib(n - 2);
}

function hard(n, _log) {
    return n + fib(16);
}

// ============================================================================
// Benchmark Runner
// ============================================================================

const results = [];

function logResult(name, time) {
    results.push({ name, time });
    console.log(`${name}: ${time.toFixed(2)}ms`);
}

async function runBenchmark(name, setup, run, iterations = 1) {
    // Warmup
    const cleanup = setup();
    flush();
    for (let i = 0; i < 3; i++) {
        run();
    }
    if (cleanup) cleanup();

    // GC if available
    if (globalThis.gc) {
        gc();
        gc();
    }

    // Run benchmark
    let fastestTime = Infinity;
    for (let attempt = 0; attempt < 5; attempt++) {
        const cleanup = setup();
        flush();

        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            run();
        }
        const end = performance.now();

        if (cleanup) cleanup();

        if (globalThis.gc) {
            gc();
            gc();
        }

        const time = end - start;
        if (time < fastestTime) {
            fastestTime = time;
        }
    }

    logResult(name, fastestTime);
    return fastestTime;
}

// ============================================================================
// Kairo Benchmarks
// ============================================================================

async function deepPropagation() {
    const len = 50;
    const iter = 50;

    let head, current;

    await runBenchmark(
        'deepPropagation',
        () => {
            head = signal(0);
            current = head;
            for (let i = 0; i < len; i++) {
                const c = current;
                current = computed(() => c() + 1);
            }
            const dispose = effect(() => current());
            return dispose;
        },
        () => {
            for (let i = 0; i < iter; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function broadPropagation() {
    let head;
    const disposers = [];

    await runBenchmark(
        'broadPropagation',
        () => {
            head = signal(0);
            disposers.length = 0;
            for (let i = 0; i < 50; i++) {
                const idx = i;
                const current = computed(() => head() + idx);
                const current2 = computed(() => current() + 1);
                disposers.push(effect(() => current2()));
            }
            return () => disposers.forEach(d => d());
        },
        () => {
            for (let i = 0; i < 50; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function avoidablePropagation() {
    let head;

    await runBenchmark(
        'avoidablePropagation',
        () => {
            head = signal(0);
            const computed1 = computed(() => head());
            const computed2 = computed(() => (computed1(), 0));
            const computed3 = computed(() => (busy(), computed2() + 1));
            const computed4 = computed(() => computed3() + 2);
            const computed5 = computed(() => computed4() + 3);
            return effect(() => {
                computed5();
                busy();
            });
        },
        () => {
            for (let i = 0; i < 1000; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function diamond() {
    const width = 5;
    let head;

    await runBenchmark(
        'diamond',
        () => {
            head = signal(0);
            const nodes = [];
            for (let i = 0; i < width; i++) {
                nodes.push(computed(() => head() + 1));
            }
            const sum = computed(() => nodes.reduce((a, n) => a + n(), 0));
            return effect(() => sum());
        },
        () => {
            for (let i = 0; i < 500; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function triangle() {
    const width = 10;
    let head;

    await runBenchmark(
        'triangle',
        () => {
            head = signal(0);
            let current = head;
            const list = [];
            for (let i = 0; i < width; i++) {
                const c = current;
                list.push(current);
                current = computed(() => c() + 1);
            }
            const sum = computed(() => list.reduce((a, n) => a + n(), 0));
            return effect(() => sum());
        },
        () => {
            for (let i = 0; i < 100; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function mux() {
    const heads = [];

    await runBenchmark(
        'mux',
        () => {
            heads.length = 0;
            for (let i = 0; i < 100; i++) {
                heads.push(signal(0));
            }
            const mux = computed(() => Object.fromEntries(heads.map((h, i) => [i, h()])));
            const splited = heads.map((_, i) => computed(() => mux()[i])).map(x => computed(() => x() + 1));
            const disposers = splited.map(x => effect(() => x()));
            return () => disposers.forEach(d => d());
        },
        () => {
            for (let i = 0; i < 10; i++) {
                heads[i].set(i);
                flush();
            }
            for (let i = 0; i < 10; i++) {
                heads[i].set(i * 2);
                flush();
            }
        }
    );
}

async function repeatedObservers() {
    const size = 30;
    let head;

    await runBenchmark(
        'repeatedObservers',
        () => {
            head = signal(0);
            const current = computed(() => {
                let result = 0;
                for (let i = 0; i < size; i++) {
                    result += head();
                }
                return result;
            });
            return effect(() => current());
        },
        () => {
            for (let i = 0; i < 100; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function unstable() {
    let head;

    await runBenchmark(
        'unstable',
        () => {
            head = signal(0);
            const double = computed(() => head() * 2);
            const inverse = computed(() => -head());
            const current = computed(() => {
                let result = 0;
                for (let i = 0; i < 20; i++) {
                    result += head() % 2 ? double() : inverse();
                }
                return result;
            });
            return effect(() => current());
        },
        () => {
            for (let i = 0; i < 100; i++) {
                head.set(i);
                flush();
            }
        }
    );
}

async function molBench() {
    let A, B;

    await runBenchmark(
        'molBench',
        () => {
            const numbers = [0, 1, 2, 3, 4];
            const res = [];
            A = signal(0);
            B = signal(0);
            const C = computed(() => (A() % 2) + (B() % 2));
            const D = computed(() => numbers.map(i => ({ x: i + (A() % 2) - (B() % 2) })));
            const E = computed(() => hard(C() + A() + D()[0].x, 'E'));
            const F = computed(() => hard(D()[2].x || B(), 'F'));
            const G = computed(() => C() + (C() || E() % 2) + D()[4].x + F());
            const d1 = effect(() => res.push(hard(G(), 'H')));
            const d2 = effect(() => res.push(G()));
            const d3 = effect(() => res.push(hard(F(), 'J')));
            return () => {
                d1();
                d2();
                d3();
            };
        },
        () => {
            for (let i = 1; i <= 100; i++) {
                B.set(1);
                flush();
                A.set(1 + i * 2);
                flush();
                A.set(2 + i * 2);
                flush();
                B.set(2);
                flush();
            }
        }
    );
}

// ============================================================================
// S.js Benchmarks
// ============================================================================

async function createSignals() {
    const COUNT = 100000;

    await runBenchmark(
        'createSignals',
        () => null,
        () => {
            for (let i = 0; i < COUNT; i++) {
                signal(i);
            }
        }
    );
}

async function createComputations() {
    const COUNT = 10000;

    await runBenchmark(
        'createComputations',
        () => {
            return null;
        },
        () => {
            const sources = [];
            for (let i = 0; i < COUNT; i++) {
                sources[i] = signal(i);
            }
            // 1 to 1
            for (let i = 0; i < COUNT; i++) {
                const s = sources[i];
                computed(() => s());
            }
        }
    );
}

async function updateSignals() {
    let s, disposers;

    await runBenchmark(
        'updateSignals',
        () => {
            s = signal(0);
            disposers = [];
            for (let j = 0; j < 4; j++) {
                disposers.push(effect(() => s()));
            }
            return () => disposers.forEach(d => d());
        },
        () => {
            for (let i = 0; i < 10000; i++) {
                s.set(i);
                flush();
            }
        }
    );
}

// ============================================================================
// CellX Benchmark
// ============================================================================

async function cellx1000() {
    const layers = 1000;
    let start;

    await runBenchmark(
        'cellx1000',
        () => {
            start = {
                prop1: signal(1),
                prop2: signal(2),
                prop3: signal(3),
                prop4: signal(4),
            };
            let layer = start;
            const disposers = [];

            for (let i = layers; i > 0; i--) {
                const m = layer;
                const s = {
                    prop1: computed(() => m.prop2()),
                    prop2: computed(() => m.prop1() - m.prop3()),
                    prop3: computed(() => m.prop2() + m.prop4()),
                    prop4: computed(() => m.prop3()),
                };
                disposers.push(effect(() => s.prop1()));
                disposers.push(effect(() => s.prop2()));
                disposers.push(effect(() => s.prop3()));
                disposers.push(effect(() => s.prop4()));
                layer = s;
            }
            return () => disposers.forEach(d => d());
        },
        () => {
            start.prop1.set(4);
            start.prop2.set(3);
            start.prop3.set(2);
            start.prop4.set(1);
            flush();
        },
        10
    );
}

// ============================================================================
// Dynamic Graph Benchmarks
// ============================================================================

function makeGraph(width, totalLayers, staticFraction, nSources, readFraction) {
    const sources = new Array(width).fill(0).map((_, i) => signal(i));
    const counter = new Counter();
    const disposers = [];

    function makeRow(srcRow, random) {
        return srcRow.map((_, myDex) => {
            const mySources = [];
            for (let sourceDex = 0; sourceDex < nSources; sourceDex++) {
                mySources.push(srcRow[(myDex + sourceDex) % srcRow.length]);
            }

            const staticNode = random() < staticFraction;
            if (staticNode) {
                return computed(() => {
                    counter.count++;
                    let sum = 0;
                    for (const src of mySources) {
                        sum += src();
                    }
                    return sum;
                });
            } else {
                const first = mySources[0];
                const tail = mySources.slice(1);
                return computed(() => {
                    counter.count++;
                    let sum = first();
                    const shouldDrop = sum & 0x1;
                    const dropDex = sum % tail.length;
                    for (let i = 0; i < tail.length; i++) {
                        if (shouldDrop && i === dropDex) continue;
                        sum += tail[i]();
                    }
                    return sum;
                });
            }
        });
    }

    let prevRow = sources;
    const random = pseudoRandom();
    const rows = [];
    for (let l = 0; l < totalLayers - 1; l++) {
        const row = makeRow(prevRow, random);
        rows.push(row);
        prevRow = row;
    }

    const rand = pseudoRandom();
    const leaves = rows[rows.length - 1];
    const skipCount = Math.round(leaves.length * (1 - readFraction));
    const copy = leaves.slice();
    for (let i = 0; i < skipCount; i++) {
        const rmDex = Math.floor(rand() * copy.length);
        copy.splice(rmDex, 1);
    }
    const readLeaves = copy;

    disposers.push(
        effect(() => {
            for (const leaf of readLeaves) {
                leaf();
            }
        })
    );

    return { sources, readLeaves, counter, dispose: () => disposers.forEach(d => d()) };
}

function runGraph(graph, iterations) {
    const { sources, readLeaves } = graph;
    for (let i = 0; i < iterations; i++) {
        const sourceDex = i % sources.length;
        sources[sourceDex].set(i + sourceDex);
        flush();
        for (const leaf of readLeaves) {
            leaf();
        }
    }
    return readLeaves.reduce((total, leaf) => leaf() + total, 0);
}

async function dynamicGraph(name, width, totalLayers, staticFraction, nSources, readFraction, iterations) {
    let graph;

    await runBenchmark(
        name,
        () => {
            graph = makeGraph(width, totalLayers, staticFraction, nSources, readFraction);
            return graph.dispose;
        },
        () => {
            graph.counter.count = 0;
            runGraph(graph, iterations);
        }
    );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    console.log('='.repeat(60));
    console.log('@slimlib/store Reactivity Benchmark');
    console.log('='.repeat(60));
    console.log('');

    console.log('--- Kairo Benchmarks ---');
    await deepPropagation();
    await broadPropagation();
    await avoidablePropagation();
    await diamond();
    await triangle();
    await mux();
    await repeatedObservers();
    await unstable();
    await molBench();

    console.log('');
    console.log('--- S.js Benchmarks ---');
    await createSignals();
    await createComputations();
    await updateSignals();

    console.log('');
    console.log('--- CellX Benchmark ---');
    await cellx1000();

    console.log('');
    console.log('--- Dynamic Graph Benchmarks ---');
    await dynamicGraph('2-10x5 - lazy80%', 10, 5, 1, 2, 0.2, 6000);
    await dynamicGraph('6-10x10 - dyn25% - lazy80%', 10, 10, 0.75, 6, 0.2, 150);
    await dynamicGraph('4-1000x12 - dyn5%', 1000, 12, 0.95, 4, 1, 70);
    await dynamicGraph('25-1000x5', 1000, 5, 1, 25, 1, 30);
    await dynamicGraph('3-5x500', 5, 500, 1, 3, 1, 5);
    await dynamicGraph('6-100x15 - dyn50%', 100, 15, 0.5, 6, 1, 20);

    console.log('');
    console.log('='.repeat(60));
    console.log('Summary (CSV format):');
    console.log('='.repeat(60));
    console.log('test,time_ms');
    for (const { name, time } of results) {
        console.log(`${name},${time.toFixed(2)}`);
    }
}

main().catch(console.error);
