//@ts-nocheck

/**
 * Multi-framework Reactivity Benchmark
 * Based on https://github.com/milomg/js-reactivity-benchmark
 *
 * Run with: node tests/benchmark.mjs
 *
 * Options:
 *   -n, --runs <number>   Number of times to rerun the entire benchmark (default: 1)
 *   -f, --file <path>     CSV file to save/compare results
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

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
} from '../dist/index.mjs';

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
    name: '@slimlib/store (proxy)',
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

// Results: Map<testName, Map<frameworkName, number[]>> - stores all times across runs
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
    const testResults = results.get(name);
    if (!testResults.has(framework.name)) testResults.set(framework.name, []);
    testResults.get(framework.name).push(fastestTime);
}

// Calculate mean of an array
function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Calculate variance of an array
function variance(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return arr.reduce((sum, val) => sum + (val - m) ** 2, 0) / (arr.length - 1);
}

// Calculate standard deviation
// biome-ignore lint/correctness/noUnusedVariables: was used
function stddev(arr) {
    return Math.sqrt(variance(arr));
}

// Parse CSV file and return Map<testName, Map<frameworkName, {mean, variance, n}>>
function parseCSV(content) {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return new Map();

    const header = lines[0].split(',');
    // Extract framework names from header (every 3rd column after test name is mean)
    // Strip the '_mean' suffix to match the framework names used in the current run
    const fwNames = header
        .slice(1)
        .filter((_, i) => i % 3 === 0)
        .map(n => n.replace('_mean', ''));

    const data = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const testName = cols[0];
        const testData = new Map();
        for (let j = 0; j < fwNames.length; j++) {
            const meanVal = parseFloat(cols[1 + j * 3]) || 0;
            const varVal = parseFloat(cols[2 + j * 3]) || 0;
            const nVal = parseInt(cols[3 + j * 3], 10) || 1;
            testData.set(fwNames[j], { mean: meanVal, variance: varVal, n: nVal });
        }
        data.set(testName, testData);
    }
    return data;
}

// Check if difference is statistically significant using Welch's t-test approximation
function isSignificant(mean1, var1, n1, mean2, var2, n2) {
    if (n1 < 2 || n2 < 2) return false;
    if (var1 === 0 && var2 === 0) return mean1 !== mean2;

    const se = Math.sqrt(var1 / n1 + var2 / n2);
    if (se === 0) return mean1 !== mean2;

    const t = Math.abs(mean1 - mean2) / se;

    // Approximate degrees of freedom (Welch-Satterthwaite)
    const num = (var1 / n1 + var2 / n2) ** 2;
    const denom = (var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1);
    const df = denom > 0 ? num / denom : 1;

    // Better t-critical approximation for alpha=0.05, two-tailed
    // Based on approximation: t ≈ z + (z³ + z) / (4 * df) where z = 1.96
    const z = 1.96;
    const tCrit = z + (z * z * z + z) / (4 * df);

    return t > tCrit;
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

// Error recovery benchmark - tests computed that throws for certain values and recovers
async function errorRecovery(framework) {
    let head;
    let dispose;

    await runBenchmark(
        framework,
        'errorRecovery',
        fw => {
            head = fw.signal(0);

            // Computed that throws for 60% of values (when val % 5 < 3)
            const maybeThrow = fw.computed(() => {
                const val = head.read();
                if (val % 5 < 3) {
                    throw new Error(`Invalid value: ${val}`);
                }
                return val * 2;
            });

            // Computed that depends on the throwing one
            const downstream = fw.computed(() => maybeThrow.read() + 1);

            // Another layer
            const final = fw.computed(() => downstream.read() + 10);

            dispose = fw.effect(() => {
                try {
                    final.read();
                } catch {
                    // Error expected for some values
                }
            });
            return dispose;
        },
        () => {
            // Cycle through values: 60% will throw (0,1,2,5,6,7,10,...), 40% will succeed (3,4,8,9,13,14,...)
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

// ============================================================================
// Pure Computed Chain Benchmark
// Tests FLAG_HAS_STATE_SOURCE optimization for non-live computed chains
// ============================================================================

async function pureComputedChain(framework) {
    // This benchmark tests the optimization where non-live computeds
    // that only depend on other computeds (no state/signals) can skip
    // the polling loop and directly verify computed sources.
    //
    // Setup:
    // - One signal at the root
    // - A chain of computeds that only depend on other computeds
    // - An unrelated signal/effect pair to increment globalVersion
    // - Repeatedly read the chain after globalVersion changes (but root unchanged)
    //
    // The optimization saves one full loop iteration for pure-computed chains.

    const chainLength = 50;
    const iterations = 1000;
    let root;
    let unrelated;
    let chain;
    let effectDispose;

    await runBenchmark(
        framework,
        'pureComputedChain',
        fw => {
            // Root signal - this will NOT change during the benchmark
            root = fw.signal(1);

            // Build a chain of computeds - each depends only on the previous computed
            chain = [];
            let prev = fw.computed(() => root.read() * 2);
            chain.push(prev);

            for (let i = 1; i < chainLength; i++) {
                const p = prev;
                prev = fw.computed(() => p.read() + 1);
                chain.push(prev);
            }

            // Unrelated signal with effect - used to increment globalVersion
            unrelated = fw.signal(0);
            effectDispose = fw.effect(() => unrelated.read());

            return effectDispose;
        },
        () => {
            // Each iteration:
            // 1. Change unrelated signal (increments globalVersion)
            // 2. Read the entire computed chain (tests polling optimization)
            //
            // Since root never changes, the chain should return cached values.
            // The optimization allows skipping the state-source polling loop
            // for computeds that only depend on other computeds.
            for (let i = 0; i < iterations; i++) {
                framework.withBatch(() => unrelated.write(i));

                // Read all computeds in the chain
                // Non-live computeds must poll to check if sources changed
                for (const c of chain) {
                    c.read();
                }
            }
        }
    );
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
    // Error handling
    errorRecovery,
    // Pure computed chain optimization
    pureComputedChain,
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
    // Parse command line arguments
    const { values: args } = parseArgs({
        options: {
            runs: {
                type: 'string',
                short: 'n',
                default: '1',
            },
            file: {
                type: 'string',
                short: 'f',
            },
        },
        strict: false,
        allowPositionals: true,
    });

    const numRuns = Math.max(1, parseInt(args.runs, 10) || 1);
    const outputFile = args.file;

    console.log('='.repeat(70));
    console.log('Multi-Framework Reactivity Benchmark');
    console.log('='.repeat(70));
    console.log('');
    console.log('Frameworks:', frameworks.map(f => f.name).join(', '));
    console.log('Number of runs:', numRuns);
    if (outputFile) {
        console.log('Output file:', outputFile);
    }
    console.log('');

    // Run benchmarks numRuns times
    for (let run = 0; run < numRuns; run++) {
        if (numRuns > 1) {
            console.log(`\n--- Run ${run + 1} of ${numRuns} ---\n`);
        }

        for (const benchmark of benchmarks) {
            process.stdout.write(`Running ${benchmark.name}...`);
            for (const framework of frameworks) {
                try {
                    await benchmark(framework);
                } catch (e) {
                    console.error(`\n  Error in ${framework.name}: ${e.message}`);
                }
            }
            // Allow GC to run between benchmarks
            // await new Promise(r => setImmediate(r));
            // if (globalThis.gc) gc();
            console.log(' done');
        }

        for (const [name, ...benchArgs] of dynamicGraphConfigs) {
            process.stdout.write(`Running ${name}...`);
            for (const framework of frameworks) {
                try {
                    await dynamicGraph(framework, name, ...benchArgs);
                } catch (e) {
                    console.error(`\n  Error in ${framework.name}: ${e.message}`);
                }
            }
            // Allow GC to run between benchmarks
            // await new Promise(r => setImmediate(r));
            // if (globalThis.gc) gc();
            console.log(' done');
        }
    }

    const fwNames = frameworks.map(f => f.name);

    // Compute stats
    const stats = new Map(); // Map<testName, Map<frameworkName, {mean, variance, n}>>

    for (const [testName, testResults] of results) {
        const testStats = new Map();

        for (const fwName of fwNames) {
            const times = testResults.get(fwName);
            if (times && times.length > 0) {
                const m = mean(times);
                const v = variance(times);
                testStats.set(fwName, { mean: m, variance: v, n: times.length });
            } else {
                testStats.set(fwName, { mean: 0, variance: 0, n: 0 });
            }
        }

        stats.set(testName, testStats);
    }

    // Calculate framework rankings across all benchmarks
    // For each test, rank frameworks by mean time (lower is better)
    // Each framework gets points equal to their rank (1st = 1 point, 2nd = 2 points, etc.)
    // Lower total score = better overall performance
    const frameworkScores = new Map(); // Map<frameworkName, {totalRank, testCount}>
    for (const fwName of fwNames) {
        frameworkScores.set(fwName, { totalRank: 0, testCount: 0 });
    }

    for (const [_testName, testStats] of stats) {
        // Get all frameworks with valid results for this test
        const validResults = [];
        for (const [fwName, s] of testStats) {
            if (s && s.n > 0 && s.mean > 0) {
                validResults.push({ name: fwName, mean: s.mean });
            }
        }

        // Sort by mean time (ascending - faster is better)
        validResults.sort((a, b) => a.mean - b.mean);

        // Assign ranks (1-based, handle ties by giving same rank)
        let currentRank = 1;
        for (let i = 0; i < validResults.length; i++) {
            // Handle ties - if same mean as previous, use same rank
            if (i > 0 && Math.abs(validResults[i].mean - validResults[i - 1].mean) < 0.0001) {
                // Same rank as previous
            } else {
                currentRank = i + 1;
            }
            const score = frameworkScores.get(validResults[i].name);
            score.totalRank += currentRank;
            score.testCount++;
        }
    }

    // Calculate average rank and prepare for display
    const rankings = [];
    for (const [fwName, score] of frameworkScores) {
        if (score.testCount > 0) {
            rankings.push({
                name: fwName,
                totalRank: score.totalRank,
                testCount: score.testCount,
                avgRank: score.totalRank / score.testCount,
            });
        }
    }

    // Sort by total rank (ascending - lower is better)
    rankings.sort((a, b) => a.totalRank - b.totalRank);

    // Print Framework Rankings section
    console.log('');
    console.log('='.repeat(70));
    console.log('Framework Rankings (by average rank across all benchmarks)');
    console.log('='.repeat(70));
    console.log('');
    console.log('  Rank  Framework'.padEnd(35) + 'Avg Rank'.padStart(12) + 'Total Score'.padStart(14) + 'Tests'.padStart(10));
    console.log(`  ${'-'.repeat(66)}`);

    for (let i = 0; i < rankings.length; i++) {
        const r = rankings[i];
        const position = `  ${(i + 1).toString().padEnd(4)}`;
        const name = r.name.padEnd(27);
        const avgRank = r.avgRank.toFixed(2).padStart(12);
        const totalScore = r.totalRank.toString().padStart(14);
        const testCount = r.testCount.toString().padStart(10);
        console.log(`${position}  ${name}${avgRank}${totalScore}${testCount}`);
    }

    console.log('');
    console.log('  (Lower average rank = better overall performance)');

    // Check if we're comparing with existing file
    const fileExists = outputFile && existsSync(outputFile);

    if (fileExists) {
        // Read existing file and compare - only show statistically significant results
        console.log('');
        console.log('='.repeat(70));
        console.log('Statistically Significant Changes');
        console.log('='.repeat(70));
        console.log('');

        const existingContent = readFileSync(outputFile, 'utf-8');
        const existingData = parseCSV(existingContent);

        let hasSignificantChanges = false;

        for (const [testName, testStats] of stats) {
            const existingTest = existingData.get(testName);
            if (!existingTest) {
                console.log(`  NEW: ${testName}`);
                hasSignificantChanges = true;
                continue;
            }

            for (const [fwName, currentStats] of testStats) {
                const existingStats = existingTest.get(fwName);
                if (!existingStats) continue;

                const significant = isSignificant(
                    currentStats.mean,
                    currentStats.variance,
                    currentStats.n,
                    existingStats.mean,
                    existingStats.variance,
                    existingStats.n
                );

                if (significant) {
                    hasSignificantChanges = true;
                    const diff = currentStats.mean - existingStats.mean;
                    const pctChange = existingStats.mean !== 0 ? ((diff / existingStats.mean) * 100).toFixed(1) : 'N/A';
                    const direction = diff > 0 ? 'SLOWER' : 'FASTER';
                    console.log(
                        `  ${direction}: ${testName} [${fwName}]: ${existingStats.mean.toFixed(2)} -> ${currentStats.mean.toFixed(2)} (${pctChange}%)`
                    );
                }
            }
        }

        if (!hasSignificantChanges) {
            console.log('  No statistically significant changes detected.');
        }
    } else {
        // No file to compare - show only mean times
        console.log('');
        console.log('='.repeat(70));
        console.log('Results (mean time in ms, lower is better)');
        console.log('='.repeat(70));
        console.log('');

        const colWidth = Math.max(30, ...fwNames.map(n => n.length + 2));
        const dataColWidth = 18;
        console.log('Test'.padEnd(colWidth) + fwNames.map(n => n.padStart(dataColWidth)).join(''));
        console.log('-'.repeat(colWidth + fwNames.length * dataColWidth));

        for (const [testName, testStats] of stats) {
            let row = testName.padEnd(colWidth);

            for (const fwName of fwNames) {
                const s = testStats.get(fwName);
                if (s && s.n > 0) {
                    row += s.mean.toFixed(2).padStart(dataColWidth);
                } else {
                    row += 'N/A'.padStart(dataColWidth);
                }
            }

            console.log(row);
        }
    }

    // Save results to file if specified (only when not comparing)
    if (outputFile && !fileExists) {
        const headerCols = ['test'];
        for (const fwName of fwNames) {
            headerCols.push(`${fwName}_mean`, `${fwName}_variance`, `${fwName}_n`);
        }

        const csvLines = [headerCols.join(',')];

        for (const [testName, testStats] of stats) {
            const row = [testName];
            for (const fwName of fwNames) {
                const s = testStats.get(fwName);
                row.push(s ? s.mean.toFixed(4) : '');
                row.push(s ? s.variance.toFixed(4) : '');
                row.push(s ? s.n : '');
            }
            csvLines.push(row.join(','));
        }

        writeFileSync(outputFile, `${csvLines.join('\n')}\n`);
        console.log('');
        console.log(`Results saved to: ${outputFile}`);
    }
}

main().catch(console.error);
