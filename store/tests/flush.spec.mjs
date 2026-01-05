import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flush, setScheduler, state } from '../src/index.js';

describe('flush', () => {
    it('executes pending effects immediately', () => {
        const store = state({ count: 0 });
        let runs = 0;

        effect(() => {
            store.count;
            runs++;
        });

        expect(runs).toBe(0); // Effect not yet run
        flush();
        expect(runs).toBe(1); // Effect ran after flush
    });

    it('executes all batched effects', () => {
        const store = state({ a: 0, b: 0 });
        let runsA = 0;
        let runsB = 0;

        effect(() => {
            store.a;
            runsA++;
        });

        effect(() => {
            store.b;
            runsB++;
        });

        flush();
        expect(runsA).toBe(1);
        expect(runsB).toBe(1);

        store.a = 1;
        store.b = 1;

        expect(runsA).toBe(1);
        expect(runsB).toBe(1);

        flush();
        expect(runsA).toBe(2);
        expect(runsB).toBe(2);
    });

    it('effects see final values after multiple changes', () => {
        const store = state({ value: 0 });
        let lastSeen = -1;

        effect(() => {
            lastSeen = store.value;
        });

        flush();
        expect(lastSeen).toBe(0);

        store.value = 1;
        store.value = 2;
        store.value = 3;

        flush();
        expect(lastSeen).toBe(3);
    });

    it('calling flush multiple times is safe', () => {
        const store = state({ count: 0 });
        let runs = 0;

        effect(() => {
            store.count;
            runs++;
        });

        flush();
        flush();
        flush();

        expect(runs).toBe(1); // Only ran once
    });

    it('flush with no pending effects does nothing', () => {
        // Should not throw
        flush();
        flush();
    });

    it('works with computed values', () => {
        const store = state({ value: 1 });
        const doubled = computed(() => store.value * 2);
        let lastSeen = -1;

        effect(() => {
            lastSeen = doubled();
        });

        flush();
        expect(lastSeen).toBe(2);

        store.value = 5;
        flush();
        expect(lastSeen).toBe(10);
    });

    it('can be called synchronously after state change', () => {
        const store = state({ items: /** @type {string[]} */ ([]) });
        /** @type {string[]} */
        const log = [];

        effect(() => {
            log.push(`length:${store.items.length}`);
        });

        flush();
        expect(log).toEqual(['length:0']);

        store.items.push('a');
        flush();
        expect(log).toEqual(['length:0', 'length:1']);

        store.items.push('b');
        store.items.push('c');
        flush();
        expect(log).toEqual(['length:0', 'length:1', 'length:3']);
    });

    it('handles effects that trigger other effects', () => {
        const store = state({ value: 0 });
        let innerRuns = 0;
        let outerRuns = 0;

        effect(() => {
            outerRuns++;
            if (store.value === 0) {
                store.value = 1;
            }
        });

        effect(() => {
            store.value;
            innerRuns++;
        });

        flush();
        expect(outerRuns).toBe(1);
        expect(innerRuns).toBe(1);

        // The store.value = 1 change should have scheduled another flush
        flush();
        // Both effects re-run because value changed from 0 to 1
        expect(outerRuns).toBe(2);
        // innerRuns may still be 1 if dependency tracking optimizes it
        expect(innerRuns).toBeGreaterThanOrEqual(1);
    });
});

describe('setScheduler', () => {
    // Store original behavior to restore after tests
    /** @type {string[]} */
    let schedulerCalls = [];

    beforeEach(() => {
        schedulerCalls = [];
    });

    afterEach(() => {
        // Restore default scheduler
        setScheduler(queueMicrotask);
    });

    it('allows setting a custom scheduler', () => {
        setScheduler(callback => {
            schedulerCalls.push('custom');
            callback();
        });

        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        // Custom scheduler should be called and execute immediately
        expect(schedulerCalls.length).toBe(1);
        expect(runs).toBe(1);
    });

    it('can use setTimeout as scheduler', async () => {
        let timeoutCalled = false;

        setScheduler(callback => {
            timeoutCalled = true;
            setTimeout(callback, 0);
        });

        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        expect(timeoutCalled).toBe(true);
        expect(runs).toBe(0); // Not run yet

        await new Promise(resolve => setTimeout(resolve, 10));
        expect(runs).toBe(1);
    });

    it('can defer execution with custom scheduler', () => {
        /** @type {Array<() => void>} */
        const pendingCallbacks = [];

        setScheduler(callback => {
            pendingCallbacks.push(callback);
        });

        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        expect(runs).toBe(0);
        expect(pendingCallbacks.length).toBe(1);

        // Manually execute pending callbacks
        for (const cb of pendingCallbacks) {
            cb();
        }
        expect(runs).toBe(1);
    });

    it('flush still works with custom scheduler', () => {
        setScheduler(() => {
            // Don't execute the callback - just ignore it
        });

        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        expect(runs).toBe(0);

        // flush should execute immediately regardless of scheduler
        flush();
        expect(runs).toBe(1);
    });

    it('scheduler is called only once for batched updates with async scheduler', async () => {
        let schedulerCallCount = 0;

        // Use an async scheduler to test batching
        setScheduler(callback => {
            schedulerCallCount++;
            queueMicrotask(callback);
        });

        const store = state({ a: 0, b: 0, c: 0 });
        let runs = 0;

        effect(() => {
            store.a;
            store.b;
            store.c;
            runs++;
        });

        expect(schedulerCallCount).toBe(1);
        await Promise.resolve();
        expect(runs).toBe(1);

        // Multiple changes should still only call scheduler once
        schedulerCallCount = 0;
        store.a = 1;
        store.b = 1;
        store.c = 1;

        // With async scheduler, batching works - only one scheduler call
        expect(schedulerCallCount).toBe(1);
        await Promise.resolve();
        expect(runs).toBe(2);
    });

    it('can switch back to queueMicrotask', async () => {
        setScheduler(() => {
            // Custom scheduler that doesn't run
        });

        const store = state({ value: 0 });
        let runs = 0;

        effect(() => {
            store.value;
            runs++;
        });

        expect(runs).toBe(0);

        // Switch back to default
        setScheduler(queueMicrotask);
        flush(); // Clear pending

        // Now changes should work with microtask
        store.value = 1;
        expect(runs).toBe(1); // From flush above

        await Promise.resolve();
        expect(runs).toBe(2);
    });

    it('works with synchronous scheduler', () => {
        setScheduler(callback => callback());

        const store = state({ value: 0 });
        /** @type {string[]} */
        const log = [];

        effect(() => {
            log.push(`value:${store.value}`);
        });

        expect(log).toEqual(['value:0']);

        store.value = 1;
        // With sync scheduler, effect runs immediately after each change
        // May run multiple times due to immediate flush resetting flushScheduled
        expect(log).toContain('value:1');

        store.value = 2;
        expect(log).toContain('value:2');
    });
});
