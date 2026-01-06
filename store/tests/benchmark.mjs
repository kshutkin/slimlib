//@ts-nocheck

/**
 * Multi-framework Reactivity Benchmark
 * Based on https://github.com/milomg/js-reactivity-benchmark
 *
 * Run with: node tests/benchmark.mjs
 */

// ============================================================================
// Framework Adapters
// ============================================================================

// @angular/core
import {
    computed as angularComputed,
    effect as angularEffect,
    signal as angularSignal,
    Injector,
    untracked,
    ɵChangeDetectionScheduler,
    ɵEffectScheduler,
} from '@angular/core';
// @vue/reactivity
import { shallowRef, computed as vueComputed, effect as vueEffect, effectScope as vueEffectScope } from '@vue/reactivity';
// svelte/internal/client
import * as svelteInternal from 'svelte/internal/client';

// @slimlib/store
import {
    setScheduler,
    computed as slimlibComputed,
    effect as slimlibEffect,
    flushEffects as slimlibFlush,
    signal as slimlibSignal,
    state as slimlibState,
} from '../src/index.js';

// Use no-op scheduler since we call flush() manually in withBatch/withBuild
setScheduler(() => {});

const slimlibFramework = {
    name: '@slimlib/store',
    signal: initial => {
        const s = slimlibSignal(initial);
        return { read: () => s(), write: v => s.set(v) };
    },
    computed: fn => {
        const c = slimlibComputed(fn);
        return { read: () => c() };
    },
    effect: fn => slimlibEffect(fn),
    withBatch: fn => {
        fn();
        slimlibFlush();
    },
    withBuild: fn => {
        const r = fn();
        slimlibFlush();
        return r;
    },
    cleanup: () => {},
};

const slimlibFrameworkProxy = {
    name: '@slimlib/store (proxy value)',
    signal: initial => {
        const s = slimlibState({ value: initial });
        return {
            read: () => s.value,
            write: v => {
                s.value = v;
            },
        };
    },
    computed: fn => {
        const c = slimlibComputed(fn);
        return { read: () => c() };
    },
    effect: fn => slimlibEffect(fn),
    withBatch: fn => {
        fn();
        slimlibFlush();
    },
    withBuild: fn => {
        const r = fn();
        slimlibFlush();
        return r;
    },
    cleanup: () => {},
};

// @preact/signals-core
import { batch as preactBatch, computed as preactComputed, effect as preactEffect, signal as preactSignal } from '@preact/signals-core';

let preactCleanups = [];
const preactFramework = {
    name: '@preact/signals-core',
    signal: initial => {
        const s = preactSignal(initial);
        return {
            read: () => s.value,
            write: v => {
                s.value = v;
            },
        };
    },
    computed: fn => {
        const c = preactComputed(fn);
        return { read: () => c.value };
    },
    effect: fn => preactCleanups.push(preactEffect(fn)),
    withBatch: fn => preactBatch(fn),
    withBuild: fn => fn(),
    cleanup: () => {
        preactCleanups.forEach(c => {
            c();
        });
        preactCleanups = [];
    },
};

// alien-signals
import {
    computed as alienComputed,
    effect as alienEffect,
    effectScope as alienEffectScope,
    signal as alienSignal,
    endBatch,
    startBatch,
} from 'alien-signals';

let alienScope = null;
const alienFramework = {
    name: 'alien-signals',
    signal: initial => {
        const s = alienSignal(initial);
        return { read: () => s(), write: v => s(v) };
    },
    computed: fn => {
        const c = alienComputed(fn);
        return { read: () => c() };
    },
    effect: fn => alienEffect(fn),
    withBatch: fn => {
        startBatch();
        fn();
        endBatch();
    },
    withBuild: fn => {
        let out;
        alienScope = alienEffectScope(() => {
            out = fn();
        });
        return out;
    },
    cleanup: () => {
        if (alienScope) {
            alienScope();
            alienScope = null;
        }
    },
};

// @reactively/core
import { Reactive, stabilize } from '@reactively/core';

const reactivelyFramework = {
    name: '@reactively/core',
    signal: initial => {
        const r = new Reactive(initial);
        return { read: () => r.get(), write: v => r.set(v) };
    },
    computed: fn => {
        const r = new Reactive(fn);
        return { read: () => r.get() };
    },
    effect: fn => new Reactive(fn, true),
    withBatch: fn => {
        fn();
        stabilize();
    },
    withBuild: fn => fn(),
    cleanup: () => {},
};

// solid-js
import { createEffect, createMemo, createRoot, createSignal, batch as solidBatch } from 'solid-js/dist/solid.cjs';

let solidDispose = null;
const solidFramework = {
    name: 'solid-js',
    signal: initial => {
        const [get, set] = createSignal(initial);
        return { read: () => get(), write: v => set(v) };
    },
    computed: fn => {
        const memo = createMemo(fn);
        return { read: () => memo() };
    },
    effect: fn => createEffect(fn),
    withBatch: fn => solidBatch(fn),
    withBuild: fn =>
        createRoot(dispose => {
            solidDispose = dispose;
            return fn();
        }),
    cleanup: () => {
        if (solidDispose) {
            solidDispose();
            solidDispose = null;
        }
    },
};

// Vue reactivity
const vueScheduled = [];
let vueScope = null;
const vueFramework = {
    name: '@vue/reactivity',
    signal: initial => {
        const data = shallowRef(initial);
        return {
            read: () => data.value,
            write: v => {
                data.value = v;
            },
        };
    },
    computed: fn => {
        const c = vueComputed(fn);
        return { read: () => c.value };
    },
    effect: fn => {
        const t = vueEffect(fn, {
            scheduler: () => {
                vueScheduled.push(t.effect);
            },
        });
    },
    withBatch: fn => {
        fn();
        while (vueScheduled.length) {
            vueScheduled.pop().run();
        }
    },
    withBuild: fn => {
        vueScope = vueEffectScope();
        return vueScope.run(fn);
    },
    cleanup: () => {
        if (vueScope) {
            vueScope.stop();
            vueScope = null;
        }
    },
};

// Angular Signals
class ArrayEffectScheduler {
    queue = new Set();

    schedule(handle) {
        this.queue.add(handle);
    }

    add(e) {
        this.queue.add(e);
    }

    remove(handle) {
        if (!this.queue.has(handle)) {
            return;
        }
        this.queue.delete(handle);
    }

    flush() {
        for (const handle of this.queue) {
            handle.run();
        }
        this.queue.clear();
    }
}

const angularScheduler = new ArrayEffectScheduler();

const createAngularInjector = () => ({
    injector: Injector.create({
        providers: [
            { provide: ɵChangeDetectionScheduler, useValue: { notify() {} } },
            { provide: ɵEffectScheduler, useValue: angularScheduler },
        ],
    }),
});

let angularInjectorObj = createAngularInjector();

const angularFramework = {
    name: '@angular/core',
    signal: initial => {
        const s = angularSignal(initial);
        return {
            read: () => s(),
            write: v => s.set(v),
        };
    },
    computed: fn => {
        const c = angularComputed(fn);
        return { read: () => c() };
    },
    effect: fn => {
        angularEffect(fn, angularInjectorObj);
    },
    withBatch: fn => {
        fn();
        angularScheduler.flush();
    },
    withBuild: fn => {
        let res;
        angularEffect(() => {
            res = untracked(fn);
        }, angularInjectorObj);
        angularScheduler.flush();
        return res;
    },
    cleanup: () => {
        angularInjectorObj.injector.destroy();
        angularInjectorObj = createAngularInjector();
    },
};

// Svelte v5
// NOTE: Uses private, internal APIs from svelte/internal/client
let svelteCleanup = () => {};
const svelteFramework = {
    name: 'svelte v5',
    signal: initial => {
        const s = svelteInternal.state(initial);
        return {
            read: () => svelteInternal.get(s),
            write: v => svelteInternal.set(s, v),
        };
    },
    computed: fn => {
        const c = svelteInternal.derived(fn);
        return { read: () => svelteInternal.get(c) };
    },
    effect: fn => {
        svelteInternal.render_effect(fn);
    },
    withBatch: fn => svelteInternal.flush(fn),
    withBuild: fn => {
        let res;
        svelteCleanup = svelteInternal.effect_root(() => {
            res = fn();
        });
        return res;
    },
    cleanup: () => {
        svelteCleanup();
        svelteCleanup = () => {};
    },
};

// ============================================================================
// All Frameworks
// ============================================================================

const frameworks = [
    slimlibFramework,
    slimlibFrameworkProxy,
    preactFramework,
    alienFramework,
    reactivelyFramework,
    solidFramework,
    vueFramework,
    angularFramework,
    svelteFramework,
];

// ============================================================================
// Helpers
// ============================================================================

class Counter {
    count = 0;
}

function busy() {
    let _a = 0;
    for (let i = 0; i < 100; i++) _a++;
}

function fib(n) {
    if (n < 2) return 1;
    return fib(n - 1) + fib(n - 2);
}

function hard(n) {
    return n + fib(16);
}

function pseudoRandom(seed = 0) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

// ============================================================================
// Benchmark Runner
// ============================================================================

const results = new Map();

async function runBenchmark(framework, name, setup, run, iterations = 1) {
    // Warmup
    let cleanup = framework.withBuild(() => setup(framework));
    for (let i = 0; i < 3; i++) run();
    if (cleanup && typeof cleanup === 'function') cleanup();
    framework.cleanup();

    if (globalThis.gc) {
        gc();
        gc();
    }

    // Run benchmark
    let fastestTime = Infinity;
    for (let attempt = 0; attempt < 5; attempt++) {
        cleanup = framework.withBuild(() => setup(framework));

        const start = performance.now();
        for (let i = 0; i < iterations; i++) run();
        const end = performance.now();

        if (cleanup && typeof cleanup === 'function') cleanup();
        framework.cleanup();

        if (globalThis.gc) {
            gc();
            gc();
        }

        const time = end - start;
        if (time < fastestTime) fastestTime = time;
    }

    if (!results.has(name)) results.set(name, new Map());
    results.get(name).set(framework.name, fastestTime);
}

// ============================================================================
// Kairo Benchmarks
// ============================================================================

async function deepPropagation(framework) {
    const len = 50,
        iter = 50;
    let head;
    let current;
    let dispose;

    await runBenchmark(
        framework,
        'deepPropagation',
        fw => {
            head = fw.signal(0);
            current = head;
            for (let i = 0; i < len; i++) {
                const c = current;
                current = fw.computed(() => c.read() + 1);
            }
            dispose = fw.effect(() => current.read());
            return dispose;
        },
        () => {
            for (let i = 0; i < iter; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function broadPropagation(framework) {
    let head;
    let disposers = [];

    await runBenchmark(
        framework,
        'broadPropagation',
        fw => {
            head = fw.signal(0);
            disposers = [];
            for (let i = 0; i < 50; i++) {
                const idx = i;
                const c = fw.computed(() => head.read() + idx);
                const c2 = fw.computed(() => c.read() + 1);
                disposers.push(fw.effect(() => c2.read()));
            }
            return () => {
                disposers.forEach(d => {
                    if (typeof d === 'function') d();
                });
            };
        },
        () => {
            for (let i = 0; i < 50; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function avoidablePropagation(framework) {
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'avoidablePropagation',
        fw => {
            head = fw.signal(0);
            const c1 = fw.computed(() => head.read());
            const c2 = fw.computed(() => {
                c1.read();
                return 0;
            });
            const c3 = fw.computed(() => {
                busy();
                return c2.read() + 1;
            });
            const c4 = fw.computed(() => c3.read() + 2);
            const c5 = fw.computed(() => c4.read() + 3);
            dispose = fw.effect(() => {
                c5.read();
                busy();
            });
            return dispose;
        },
        () => {
            for (let i = 0; i < 1000; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function diamond(framework) {
    const width = 5;
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'diamond',
        fw => {
            head = fw.signal(0);
            const nodes = [];
            for (let i = 0; i < width; i++) {
                nodes.push(fw.computed(() => head.read() + 1));
            }
            const sum = fw.computed(() => nodes.reduce((a, n) => a + n.read(), 0));
            dispose = fw.effect(() => sum.read());
            return dispose;
        },
        () => {
            for (let i = 0; i < 500; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function triangle(framework) {
    const width = 10;
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'triangle',
        fw => {
            head = fw.signal(0);
            let current = head;
            const list = [];
            for (let i = 0; i < width; i++) {
                const c = current;
                list.push(current);
                current = fw.computed(() => c.read() + 1);
            }
            const sum = fw.computed(() => list.reduce((a, n) => a + n.read(), 0));
            dispose = fw.effect(() => sum.read());
            return dispose;
        },
        () => {
            for (let i = 0; i < 100; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function mux(framework) {
    let heads;
    let disposers;

    await runBenchmark(
        framework,
        'mux',
        fw => {
            heads = [];
            for (let i = 0; i < 100; i++) heads.push(fw.signal(0));
            const mux = fw.computed(() => Object.fromEntries(heads.map((h, i) => [i, h.read()])));
            const split = heads.map((_, i) => fw.computed(() => mux.read()[i]));
            const mapped = split.map(x => fw.computed(() => x.read() + 1));
            disposers = mapped.map(x => fw.effect(() => x.read()));
            return () => {
                disposers.forEach(d => {
                    if (typeof d === 'function') d();
                });
            };
        },
        () => {
            for (let i = 0; i < 10; i++) framework.withBatch(() => heads[i].write(i));
            for (let i = 0; i < 10; i++) framework.withBatch(() => heads[i].write(i * 2));
        }
    );
}

async function repeatedObservers(framework) {
    const size = 30;
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'repeatedObservers',
        fw => {
            head = fw.signal(0);
            const current = fw.computed(() => {
                let result = 0;
                for (let i = 0; i < size; i++) result += head.read();
                return result;
            });
            dispose = fw.effect(() => current.read());
            return dispose;
        },
        () => {
            for (let i = 0; i < 100; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function unstable(framework) {
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'unstable',
        fw => {
            head = fw.signal(0);
            const double = fw.computed(() => head.read() * 2);
            const inverse = fw.computed(() => -head.read());
            const current = fw.computed(() => {
                let result = 0;
                for (let i = 0; i < 20; i++) {
                    result += head.read() % 2 ? double.read() : inverse.read();
                }
                return result;
            });
            dispose = fw.effect(() => current.read());
            return dispose;
        },
        () => {
            for (let i = 0; i < 100; i++) {
                framework.withBatch(() => head.write(i));
            }
        }
    );
}

async function molBench(framework) {
    let A;
    let B;
    let disposers;

    await runBenchmark(
        framework,
        'molBench',
        fw => {
            const numbers = [0, 1, 2, 3, 4];
            const res = [];
            A = fw.signal(0);
            B = fw.signal(0);
            const C = fw.computed(() => (A.read() % 2) + (B.read() % 2));
            const D = fw.computed(() => numbers.map(i => ({ x: i + (A.read() % 2) - (B.read() % 2) })));
            const E = fw.computed(() => hard(C.read() + A.read() + D.read()[0].x));
            const F = fw.computed(() => hard(D.read()[2].x || B.read()));
            const G = fw.computed(() => C.read() + (C.read() || E.read() % 2) + D.read()[4].x + F.read());
            const d1 = fw.effect(() => res.push(hard(G.read())));
            const d2 = fw.effect(() => res.push(G.read()));
            const d3 = fw.effect(() => res.push(hard(F.read())));
            disposers = [d1, d2, d3];
            return () => {
                disposers.forEach(d => {
                    if (typeof d === 'function') d();
                });
            };
        },
        () => {
            for (let i = 1; i <= 100; i++) {
                framework.withBatch(() => B.write(1));
                framework.withBatch(() => A.write(1 + i * 2));
                framework.withBatch(() => A.write(2 + i * 2));
                framework.withBatch(() => B.write(2));
            }
        }
    );
}

// ============================================================================
// S.js Benchmarks
// ============================================================================

async function createSignals(framework) {
    const COUNT = 100000;

    await runBenchmark(
        framework,
        'createSignals',
        () => null,
        () => {
            for (let i = 0; i < COUNT; i++) framework.signal(i);
        }
    );
}

async function createComputations(framework) {
    const COUNT = 10000;

    await runBenchmark(
        framework,
        'createComputations',
        () => null,
        () => {
            const sources = [];
            for (let i = 0; i < COUNT; i++) sources[i] = framework.signal(i);
            for (let i = 0; i < COUNT; i++) {
                const s = sources[i];
                framework.computed(() => s.read());
            }
        }
    );
}

async function updateSignals(framework) {
    let s;
    let disposers;

    await runBenchmark(
        framework,
        'updateSignals',
        fw => {
            s = fw.signal(0);
            disposers = [];
            for (let j = 0; j < 4; j++) disposers.push(fw.effect(() => s.read()));
            return () => {
                disposers.forEach(d => {
                    if (typeof d === 'function') d();
                });
            };
        },
        () => {
            for (let i = 0; i < 10000; i++) {
                framework.withBatch(() => s.write(i));
            }
        }
    );
}

// ============================================================================
// CellX Benchmark
// ============================================================================

async function cellx1000(framework) {
    const layers = 1000;
    let start;

    await runBenchmark(
        framework,
        'cellx1000',
        fw => {
            start = {
                prop1: fw.signal(1),
                prop2: fw.signal(2),
                prop3: fw.signal(3),
                prop4: fw.signal(4),
            };
            let layer = start;
            const disposers = [];
            for (let i = layers; i > 0; i--) {
                const m = layer;
                const s = {
                    prop1: fw.computed(() => m.prop2.read()),
                    prop2: fw.computed(() => m.prop1.read() - m.prop3.read()),
                    prop3: fw.computed(() => m.prop2.read() + m.prop4.read()),
                    prop4: fw.computed(() => m.prop3.read()),
                };
                disposers.push(fw.effect(() => s.prop1.read()));
                disposers.push(fw.effect(() => s.prop2.read()));
                disposers.push(fw.effect(() => s.prop3.read()));
                disposers.push(fw.effect(() => s.prop4.read()));
                layer = s;
            }
            return () => {
                disposers.forEach(d => {
                    if (typeof d === 'function') d();
                });
            };
        },
        () => {
            framework.withBatch(() => {
                start.prop1.write(4);
                start.prop2.write(3);
                start.prop3.write(2);
                start.prop4.write(1);
            });
        },
        10
    );
}

// ============================================================================
// Dynamic Graph Benchmarks
// ============================================================================

function makeGraph(framework, width, totalLayers, staticFraction, nSources, readFraction) {
    const sources = [];
    for (let i = 0; i < width; i++) sources.push(framework.signal(i));
    const counter = new Counter();
    const disposers = [];

    function makeRow(srcRow, random) {
        return srcRow.map((_, myDex) => {
            const mySources = [];
            for (let k = 0; k < nSources; k++) {
                mySources.push(srcRow[(myDex + k) % srcRow.length]);
            }
            const staticNode = random() < staticFraction;
            if (staticNode) {
                return framework.computed(() => {
                    counter.count++;
                    let sum = 0;
                    for (const src of mySources) sum += src.read();
                    return sum;
                });
            } else {
                const first = mySources[0];
                const tail = mySources.slice(1);
                return framework.computed(() => {
                    counter.count++;
                    let sum = first.read();
                    const shouldDrop = sum & 0x1;
                    const dropDex = sum % tail.length;
                    for (let i = 0; i < tail.length; i++) {
                        if (shouldDrop && i === dropDex) continue;
                        sum += tail[i].read();
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
        framework.effect(() => {
            readLeaves.forEach(leaf => {
                leaf.read();
            });
        })
    );

    return {
        sources,
        readLeaves,
        counter,
        dispose: () => {
            disposers.forEach(d => {
                if (typeof d === 'function') d();
            });
        },
    };
}

function runGraph(framework, graph, iterations) {
    const { sources, readLeaves } = graph;
    for (let i = 0; i < iterations; i++) {
        const sourceDex = i % sources.length;
        framework.withBatch(() => sources[sourceDex].write(i + sourceDex));
        for (const leaf of readLeaves) leaf.read();
    }
}

async function dynamicGraph(framework, name, width, totalLayers, staticFraction, nSources, readFraction, iterations) {
    let graph;

    await runBenchmark(
        framework,
        name,
        fw => {
            graph = makeGraph(fw, width, totalLayers, staticFraction, nSources, readFraction);
            return graph.dispose;
        },
        () => {
            graph.counter.count = 0;
            runGraph(framework, graph, iterations);
        }
    );
}

// ============================================================================
// Run All Benchmarks
// ============================================================================

const benchmarks = [
    // Kairo
    deepPropagation,
    broadPropagation,
    avoidablePropagation,
    diamond,
    triangle,
    mux,
    repeatedObservers,
    unstable,
    molBench,
    // S.js
    createSignals,
    createComputations,
    updateSignals,
    // CellX
    cellx1000,
];

const dynamicGraphConfigs = [
    ['2-10x5 - lazy80%', 10, 5, 1, 2, 0.2, 6000],
    ['6-10x10 - dyn25% - lazy80%', 10, 10, 0.75, 6, 0.2, 150],
    ['4-1000x12 - dyn5%', 1000, 12, 0.95, 4, 1, 70],
    ['25-1000x5', 1000, 5, 1, 25, 1, 30],
    ['3-5x500', 5, 500, 1, 3, 1, 5],
    ['6-100x15 - dyn50%', 100, 15, 0.5, 6, 1, 20],
];

async function main() {
    console.log('='.repeat(70));
    console.log('Multi-Framework Reactivity Benchmark');
    console.log('='.repeat(70));
    console.log('');
    console.log('Frameworks:', frameworks.map(f => f.name).join(', '));
    console.log('');

    for (const benchmark of benchmarks) {
        process.stdout.write(`Running ${benchmark.name}...`);
        for (const framework of frameworks) {
            try {
                await benchmark(framework);
            } catch (e) {
                console.error(`\n  Error in ${framework.name}: ${e.message}`);
            }
        }
        console.log(' done');
    }

    for (const [name, ...args] of dynamicGraphConfigs) {
        process.stdout.write(`Running ${name}...`);
        for (const framework of frameworks) {
            try {
                await dynamicGraph(framework, name, ...args);
            } catch (e) {
                console.error(`\n  Error in ${framework.name}: ${e.message}`);
            }
        }
        console.log(' done');
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('Results (time in ms, lower is better)');
    console.log('='.repeat(70));
    console.log('');

    // Print header
    const fwNames = frameworks.map(f => f.name);
    const colWidth = Math.max(30, ...fwNames.map(n => n.length + 2));
    console.log('Test'.padEnd(colWidth) + fwNames.map(n => n.padStart(18)).join(''));
    console.log('-'.repeat(colWidth + fwNames.length * 18));

    // Print results
    for (const [testName, testResults] of results) {
        let row = testName.padEnd(colWidth);
        for (const fwName of fwNames) {
            const time = testResults.get(fwName);
            row += (time !== undefined ? time.toFixed(2) : 'N/A').padStart(18);
        }
        console.log(row);
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('CSV Output');
    console.log('='.repeat(70));
    console.log('');
    console.log(['test', ...fwNames].join(','));
    for (const [testName, testResults] of results) {
        const values = fwNames.map(n => {
            const t = testResults.get(n);
            return t !== undefined ? t.toFixed(2) : '';
        });
        console.log([testName, ...values].join(','));
    }
}

main().catch(console.error);
