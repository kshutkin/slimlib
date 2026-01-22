/**
 * V8 Deoptimization Check Script
 * 
 * This script exercises the store implementation and can be run with V8 flags
 * to detect deoptimizations and understand JIT behavior.
 * 
 * Usage:
 *   node --trace-deopt tests/deopt-check.mjs         # Show deoptimizations
 *   node --trace-opt tests/deopt-check.mjs           # Show optimizations
 *   node --trace-opt --trace-deopt tests/deopt-check.mjs  # Both
 *   node --trace-ic tests/deopt-check.mjs            # Inline cache state changes
 *   node --print-opt-code tests/deopt-check.mjs      # Print optimized code
 * 
 * Tips for avoiding deoptimizations:
 *   - Avoid hidden class changes (adding properties after creation)
 *   - Use consistent types for variables
 *   - Avoid deleting properties
 *   - Avoid arguments object manipulation
 *   - Initialize all properties in constructors
 */

import { state, signal, computed, effect, flushEffects } from '../dist/index.mjs';

// Utility to run a function many times to trigger JIT compilation
const hotLoop = (fn, iterations = 100000) => {
    for (let i = 0; i < iterations; i++) {
        fn(i);
    }
};

// Utility to run a function many times and measure time
const benchmark = (name, fn, iterations = 100000) => {
    // Warm up JIT
    hotLoop(fn, 10000);
    
    const start = performance.now();
    hotLoop(fn, iterations);
    const end = performance.now();
    
    console.log(`${name}: ${(end - start).toFixed(3)}ms for ${iterations} iterations (${((end - start) / iterations * 1000).toFixed(4)}µs/op)`);
};

console.log('=== V8 Deoptimization Check for @slimlib/store ===\n');

// Test 1: Basic state reads and writes (monomorphic access pattern)
console.log('--- Test 1: Basic state reads and writes ---');
{
    const store = state({ count: 0, name: 'test' });
    
    benchmark('state read (number)', () => store.count);
    benchmark('state read (string)', () => store.name);
    benchmark('state write (number)', (i) => { store.count = i; });
    benchmark('state write (string)', (i) => { store.name = `test${i}`; });
}
console.log();

// Test 2: Nested state access
console.log('--- Test 2: Nested state access ---');
{
    const store = state({
        user: {
            profile: {
                name: 'John',
                age: 30
            }
        }
    });
    
    benchmark('nested state read', () => store.user.profile.name);
    benchmark('nested state write', (i) => { store.user.profile.age = i; });
}
console.log();

// Test 3: Signal operations
console.log('--- Test 3: Signal operations ---');
{
    const count = signal(0);
    
    benchmark('signal read', () => count());
    benchmark('signal write', (i) => count.set(i));
}
console.log();

// Test 4: Computed with dependencies
console.log('--- Test 4: Computed with dependencies ---');
{
    const a = signal(1);
    const b = signal(2);
    const sum = computed(() => a() + b());
    
    // First access to set up dependencies
    sum();
    
    benchmark('computed read (cached)', () => sum());
    benchmark('computed read (after invalidation)', () => {
        a.set(Math.random());
        return sum();
    });
}
console.log();

// Test 5: Effect creation and disposal
console.log('--- Test 5: Effect creation and disposal ---');
{
    const count = signal(0);
    
    const iterations = 1000;
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
        const dispose = effect(() => {
            count();
        });
        flushEffects();
        dispose();
    }
    
    const end = performance.now();
    console.log(`effect create/flush/dispose: ${(end - start).toFixed(3)}ms for ${iterations} iterations (${((end - start) / iterations * 1000).toFixed(4)}µs/op)`);
}
console.log();

// Test 6: Array operations through state
console.log('--- Test 6: Array operations through state ---');
{
    const store = state({ items: [1, 2, 3, 4, 5] });
    
    benchmark('array index read', (i) => store.items[i % 5]);
    benchmark('array index write', (i) => { store.items[i % 5] = i; });
    benchmark('array push (via method)', (i) => {
        store.items.push(i);
        if (store.items.length > 100) store.items.length = 5;
    });
}
console.log();

// Test 7: Polymorphic access patterns (potential deopt trigger)
console.log('--- Test 7: Polymorphic access patterns (potential deopt) ---');
{
    const stores = [
        state({ value: 1 }),
        state({ value: 'string' }),
        state({ value: true }),
        state({ value: null }),
        state({ value: { nested: 1 } }),
    ];
    
    benchmark('polymorphic state read', (i) => stores[i % stores.length].value);
}
console.log();

// Test 8: Megamorphic call sites (potential deopt trigger)
console.log('--- Test 8: Megamorphic computed access ---');
{
    const signals = Array.from({ length: 10 }, (_, i) => signal(i));
    const computeds = signals.map((s, i) => computed(() => s() * (i + 1)));
    
    benchmark('megamorphic computed read', (i) => computeds[i % computeds.length]());
}
console.log();

// Test 9: Property addition (hidden class transition - potential deopt)
console.log('--- Test 9: Property addition patterns ---');
{
    const addProperties = () => {
        const store = state({});
        store.a = 1;
        store.b = 2;
        store.c = 3;
        return store.a + store.b + store.c;
    };
    
    benchmark('dynamic property addition', addProperties, 1000);
}
console.log();

// Test 10: Effect with multiple dependencies
console.log('--- Test 10: Effect with multiple dependencies ---');
{
    const a = signal(0);
    const b = signal(0);
    const c = signal(0);
    const d = signal(0);
    
    let effectRunCount = 0;
    const dispose = effect(() => {
        a() + b() + c() + d();
        effectRunCount++;
    });
    flushEffects();
    
    const iterations = 1000;
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
        a.set(i);
        b.set(i);
        c.set(i);
        d.set(i);
        flushEffects();
    }
    
    const end = performance.now();
    dispose();
    
    console.log(`effect with 4 deps (4 updates + flush): ${(end - start).toFixed(3)}ms for ${iterations} iterations (${((end - start) / iterations * 1000).toFixed(4)}µs/op)`);
    console.log(`  (effect ran ${effectRunCount} times)`);
}
console.log();

// Test 11: Computed chain
console.log('--- Test 11: Computed chain ---');
{
    const base = signal(1);
    const c1 = computed(() => base() * 2);
    const c2 = computed(() => c1() + 1);
    const c3 = computed(() => c2() * 3);
    const c4 = computed(() => c3() - 5);
    
    // Initialize chain
    c4();
    
    benchmark('computed chain read (cached)', () => c4());
    benchmark('computed chain read (invalidated)', () => {
        base.set(Math.random());
        return c4();
    });
}
console.log();

// Test 12: Mixed types in same computed (potential deopt)
console.log('--- Test 12: Mixed return types in computed ---');
{
    const flag = signal(true);
    const value = signal(42);
    const text = signal('hello');
    
    // This computed returns different types - potential deopt trigger
    const mixed = computed(() => {
        if (flag()) return value();
        return text();
    });
    
    benchmark('mixed type computed read', (i) => {
        flag.set(i % 2 === 0);
        return mixed();
    });
}
console.log();

// Test 13: Diamond dependency pattern
console.log('--- Test 13: Diamond dependency pattern ---');
{
    const source = signal(1);
    const left = computed(() => source() * 2);
    const right = computed(() => source() * 3);
    const diamond = computed(() => left() + right());
    
    diamond();
    
    benchmark('diamond pattern read (cached)', () => diamond());
    benchmark('diamond pattern read (invalidated)', () => {
        source.set(Math.random());
        return diamond();
    });
}
console.log();

// Test 14: Large state object
console.log('--- Test 14: Large state object access ---');
{
    const largeState = state(
        Object.fromEntries(
            Array.from({ length: 100 }, (_, i) => [`prop${i}`, i])
        )
    );
    
    benchmark('large object property read', (i) => largeState[`prop${i % 100}`]);
    benchmark('large object property write', (i) => { largeState[`prop${i % 100}`] = i; });
}
console.log();

// Test 15: State with methods (functions)
console.log('--- Test 15: State with array methods ---');
{
    const store = state({
        items: [1, 2, 3, 4, 5],
    });
    
    benchmark('array map method', () => store.items.map(x => x * 2));
    benchmark('array filter method', () => store.items.filter(x => x > 2));
    benchmark('array reduce method', () => store.items.reduce((a, b) => a + b, 0));
}
console.log();

console.log('=== Deoptimization check complete ===');
console.log('\nTo see actual deoptimizations, run with:');
console.log('  node --trace-deopt tests/deopt-check.mjs 2>&1 | grep -i "deoptimiz"');
console.log('\nTo see what gets optimized:');
console.log('  node --trace-opt tests/deopt-check.mjs 2>&1 | grep -i "optimiz"');
console.log('\nTo see inline cache misses:');
console.log('  node --trace-ic tests/deopt-check.mjs 2>&1 | head -100');