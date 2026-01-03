import { describe, expect, it, vi } from 'vitest';

import { createStore, effect } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

describe('effect', () => {
    it('runs effect on next microtask', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        // Effect should not run synchronously
        expect(subscriber).toHaveBeenCalledTimes(0);

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith(0);
    });

    it('re-runs when dependencies change', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        effect(() => {
            subscriber(store.count);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        store.count = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(2);
        expect(subscriber).toHaveBeenLastCalledWith(1);

        store.count = 2;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(3);
        expect(subscriber).toHaveBeenLastCalledWith(2);
    });

    it('does not re-run when untracked properties change', async () => {
        const subscriber = vi.fn();
        const store = createStore({ tracked: 0, untracked: 0 });

        effect(() => {
            subscriber(store.tracked);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing untracked property should not trigger effect
        store.untracked = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        // Changing tracked property should trigger effect
        store.tracked = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('supports cleanup function', async () => {
        let cleanupCalled = false;
        const store = createStore({ count: 0 });

        effect(() => {
            store.count; // Track dependency
            return () => {
                cleanupCalled = true;
            };
        });

        await flushPromises();
        expect(cleanupCalled).toBe(false);

        store.count = 1;
        await flushPromises();
        expect(cleanupCalled).toBe(true);
    });

    it('cleanup is called before each re-run', async () => {
        /** @type {string[]} */
        const calls = [];
        const store = createStore({ count: 0 });

        effect(() => {
            const currentCount = store.count;
            calls.push(`run:${currentCount}`);
            return () => {
                // Cleanup captures the value at the time it was created
                calls.push(`cleanup:${currentCount}`);
            };
        });

        await flushPromises();
        expect(calls).toEqual(['run:0']);

        store.count = 1;
        await flushPromises();
        // Cleanup runs with old value captured in closure
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1']);

        store.count = 2;
        await flushPromises();
        expect(calls).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
    });

    it('dispose stops effect from running', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1);

        dispose();

        store.count = 1;
        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('dispose calls cleanup function', async () => {
        let cleanupCalled = false;
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            store.count;
            return () => {
                cleanupCalled = true;
            };
        });

        await flushPromises();
        expect(cleanupCalled).toBe(false);

        dispose();
        expect(cleanupCalled).toBe(true);
    });

    it('tracks nested object properties', async () => {
        const subscriber = vi.fn();
        const store = createStore({ user: { name: 'John', age: 30 } });

        effect(() => {
            subscriber(store.user.name);
        });

        await flushPromises();
        expect(subscriber).toHaveBeenCalledWith('John');

        store.user.name = 'Jane';
        await flushPromises();
        expect(subscriber).toHaveBeenCalledWith('Jane');
        expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('only tracks accessed properties', async () => {
        let nameRuns = 0;
        let ageRuns = 0;
        const store = createStore({ user: { name: 'John', age: 30 } });

        effect(() => {
            store.user.name;
            nameRuns++;
        });

        effect(() => {
            store.user.age;
            ageRuns++;
        });

        await flushPromises();
        expect(nameRuns).toBe(1);
        expect(ageRuns).toBe(1);

        store.user.name = 'Jane';
        await flushPromises();
        expect(nameRuns).toBe(2);
        expect(ageRuns).toBe(1); // Age effect should not run

        store.user.age = 31;
        await flushPromises();
        expect(nameRuns).toBe(2); // Name effect should not run
        expect(ageRuns).toBe(2);
    });

    it('handles conditional dependencies', async () => {
        let runs = 0;
        const store = createStore({ flag: true, a: 1, b: 2 });

        effect(() => {
            runs++;
            if (store.flag) {
                store.a;
            } else {
                store.b;
            }
        });

        await flushPromises();
        expect(runs).toBe(1);

        // When flag is true, only 'a' and 'flag' are tracked
        store.b = 10;
        await flushPromises();
        expect(runs).toBe(1); // Should NOT trigger

        store.a = 5;
        await flushPromises();
        expect(runs).toBe(2); // SHOULD trigger

        // Now switch the flag
        store.flag = false;
        await flushPromises();
        expect(runs).toBe(3);

        // Now 'b' and 'flag' should be tracked, not 'a'
        store.a = 100;
        await flushPromises();
        expect(runs).toBe(3); // Should NOT trigger

        store.b = 20;
        await flushPromises();
        expect(runs).toBe(4); // SHOULD trigger
    });

    it('handles array mutations', async () => {
        let runs = 0;
        const store = createStore({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            store.items.length;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.items.push(4);
        await flushPromises();
        expect(runs).toBe(2);
    });

    it('handles array iteration', async () => {
        let runs = 0;
        let sum = 0;
        const store = createStore({ items: [1, 2, 3] });

        effect(() => {
            runs++;
            sum = 0;
            for (const item of store.items) {
                sum += item;
            }
        });

        await flushPromises();
        expect(runs).toBe(1);
        expect(sum).toBe(6);

        store.items.push(4);
        await flushPromises();
        expect(runs).toBe(2);
        expect(sum).toBe(10);
    });

    it('does not run if value is the same', async () => {
        let runs = 0;
        const store = createStore({ count: 0 });

        effect(() => {
            runs++;
            store.count;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.count = 0; // Same value
        await flushPromises();
        expect(runs).toBe(1); // Should not run
    });

    it('self-dispose within effect', async () => {
        let runs = 0;
        const store = createStore({ count: 0 });

        /** @type {() => void} */
        let dispose;
        dispose = effect(() => {
            runs++;
            if (store.count > 2) {
                dispose();
            }
        });

        await flushPromises();
        expect(runs).toBe(1);

        store.count = 1;
        await flushPromises();
        expect(runs).toBe(2);

        store.count = 3;
        await flushPromises();
        expect(runs).toBe(3);

        // Effect disposed itself, further changes should not trigger
        store.count = 4;
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('multiple stores in single effect', async () => {
        let runs = 0;
        const store1 = createStore({ a: 1 });
        const store2 = createStore({ b: 2 });

        effect(() => {
            runs++;
            store1.a;
            store2.b;
        });

        await flushPromises();
        expect(runs).toBe(1);

        store1.a = 10;
        await flushPromises();
        expect(runs).toBe(2);

        store2.b = 20;
        await flushPromises();
        expect(runs).toBe(3);
    });

    it('dispose before first run cancels effect', async () => {
        const subscriber = vi.fn();
        const store = createStore({ count: 0 });

        const dispose = effect(() => {
            subscriber(store.count);
        });

        // Dispose before microtask runs
        dispose();

        await flushPromises();
        expect(subscriber).toHaveBeenCalledTimes(0);
    });
});
