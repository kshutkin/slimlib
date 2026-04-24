//@ts-nocheck

/**
 * Multi-framework Reactivity Benchmark (mitata edition)
 *
 * Duplicates the scenarios from tests/benchmark.mjs but drives them through
 * the `mitata` micro-benchmark harness, which prints per-group summary
 * reports comparing frameworks.
 *
 * Run with: node tests/benchmark-mitata.mjs
 */

import { bench, group, run, summary } from 'mitata';

import { benchmarks, dynamicGraph, dynamicGraphConfigs, frameworks, setRunImpl } from './benchmark.mjs';

// Registry populated by driving every benchmark function once per framework
// with a "collecting" runImpl. Each entry captures the closures needed to
// re-run the scenario inside a mitata bench.
//
// Shape: Map<testName, Array<{ framework, setup, run, iterations }>>
const registry = new Map();

setRunImpl((framework, name, setup, runFn, iterations = 1) => {
    if (!registry.has(name)) registry.set(name, []);
    registry.get(name).push({ framework, setup, run: runFn, iterations });
});

// Populate the registry by invoking each benchmark for every framework.
// Each benchmark function internally calls runBenchmark(...), which under the
// swapped-in runImpl just records setup/run closures instead of executing.
for (const benchmark of benchmarks) {
    for (const framework of frameworks) {
        try {
            await benchmark(framework);
        } catch (e) {
            console.error(`Failed to register ${benchmark.name} for ${framework.name}: ${e.message}`);
        }
    }
}

for (const [name, ...benchArgs] of dynamicGraphConfigs) {
    for (const framework of frameworks) {
        try {
            await dynamicGraph(framework, name, ...benchArgs);
        } catch (e) {
            console.error(`Failed to register ${name} for ${framework.name}: ${e.message}`);
        }
    }
}

// Register mitata benches, grouped by scenario name with a summary block so
// mitata emits its relative comparison table per group.
for (const [name, entries] of registry) {
    group(name, () => {
        summary(() => {
            for (const entry of entries) {
                const { framework, setup, run: runFn, iterations } = entry;
                bench(framework.name, function* () {
                    let cleanup = framework.withBuild(() => setup(framework));
                    // Warmup a few iterations to mirror original benchmark behavior.
                    for (let i = 0; i < 3; i++) runFn();
                    if (cleanup && typeof cleanup === 'function') cleanup();
                    framework.cleanup();

                    cleanup = framework.withBuild(() => setup(framework));

                    yield () => {
                        for (let i = 0; i < iterations; i++) runFn();
                    };

                    if (cleanup && typeof cleanup === 'function') cleanup();
                    framework.cleanup();
                });
            }
        });
    });
}

await run();
