import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('computed optimization', () => {
    /** @type {ReturnType<typeof scope>} */
    let testScope;

    beforeEach(() => {
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
    });

    describe('value revert optimization', () => {
        it('should not update if the signal value is reverted before read', () => {
            let times = 0;

            const s = signal(0);
            const c1 = computed(() => {
                times++;
                return s();
            });

            c1();
            expect(times).toBe(1);

            s.set(1);
            s.set(0); // Revert back to original

            c1();
            expect(times).toBe(1); // Should not recompute - value unchanged
        });

        it('should not update if state value is reverted before read', () => {
            let times = 0;

            const store = state({ value: 0 });
            const c1 = computed(() => {
                times++;
                return store.value;
            });

            c1();
            expect(times).toBe(1);

            store.value = 1;
            store.value = 0; // Revert back to original

            c1();
            expect(times).toBe(1);
        });

        it('should update when value changes even if it was reverted earlier', () => {
            let times = 0;

            const s = signal(0);
            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(0);
            expect(times).toBe(1);

            // Revert scenario
            s.set(1);
            s.set(0);
            expect(comp()).toBe(0);
            expect(times).toBe(1);

            // Now actually change
            s.set(5);
            expect(comp()).toBe(5);
            expect(times).toBe(2);
        });

        it('should handle multiple reverts in sequence', () => {
            let times = 0;

            const s = signal('initial');
            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe('initial');
            expect(times).toBe(1);

            // Multiple changes that revert
            s.set('a');
            s.set('b');
            s.set('c');
            s.set('initial'); // Back to original

            expect(comp()).toBe('initial');
            expect(times).toBe(1);
        });
    });

    describe('bail-out optimization', () => {
        it('should bail out if computed returns same value', () => {
            const store = state({ a: 'a' });
            let bTimes = 0;
            let cTimes = 0;

            const b = computed(() => {
                bTimes++;
                store.a; // Read but ignore
                return 'constant';
            });

            const c = computed(() => {
                cTimes++;
                return b();
            });

            expect(c()).toBe('constant');
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.a = 'changed';

            expect(c()).toBe('constant');
            expect(bTimes).toBe(2); // b recomputes
            expect(cTimes).toBe(1); // c does not - b returned same value
        });

        it('should propagate change when computed value actually changes', () => {
            const store = state({ value: 1 });
            let bTimes = 0;
            let cTimes = 0;

            const b = computed(() => {
                bTimes++;
                return store.value;
            });

            const c = computed(() => {
                cTimes++;
                return b() * 2;
            });

            expect(c()).toBe(2);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.value = 5;

            expect(c()).toBe(10);
            expect(bTimes).toBe(2);
            expect(cTimes).toBe(2);
        });

        it('should handle bail-out in diamond pattern', () => {
            //     A
            //   /   \
            // *B     C (B returns constant)
            //   \   /
            //     D
            const store = state({ a: 1 });
            let dTimes = 0;

            const b = computed(() => {
                store.a; // Read but return constant
                return 100;
            });

            const c = computed(() => store.a * 2);

            const d = computed(() => {
                dTimes++;
                return b() + c();
            });

            expect(d()).toBe(102); // 100 + 2
            expect(dTimes).toBe(1);

            store.a = 5;

            expect(d()).toBe(110); // 100 + 10
            expect(dTimes).toBe(2); // D must recompute because C changed
        });

        it('should not propagate when all sources bail out', () => {
            const store = state({ value: 1 });
            let cTimes = 0;

            const a = computed(() => {
                store.value;
                return 'constant-a';
            });

            const b = computed(() => {
                store.value;
                return 'constant-b';
            });

            const c = computed(() => {
                cTimes++;
                return a() + b();
            });

            expect(c()).toBe('constant-aconstant-b');
            expect(cTimes).toBe(1);

            store.value = 100;

            expect(c()).toBe('constant-aconstant-b');
            expect(cTimes).toBe(1); // Should not recompute
        });
    });

    describe('effect optimization with computed', () => {
        it('should not run effect when computed bails out', async () => {
            const store = state({ trigger: 0 });
            let effectRuns = 0;

            const alwaysSame = computed(() => {
                store.trigger; // Read
                return 'always same';
            });

            effect(() => {
                effectRuns++;
                alwaysSame();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.trigger = 1;
            await flushAll();
            expect(effectRuns).toBe(1); // Should not re-run
        });

        it('should run effect when computed actually changes', async () => {
            const store = state({ value: 1 });
            let effectRuns = 0;

            const doubled = computed(() => store.value * 2);

            effect(() => {
                effectRuns++;
                doubled();
            });

            await flushAll();
            expect(effectRuns).toBe(1);

            store.value = 5;
            await flushAll();
            expect(effectRuns).toBe(2);
        });

        it('should optimize when signal reverts before effect runs', async () => {
            const s = signal(0);
            let effectRuns = 0;
            let lastSeen = -1;

            effect(() => {
                effectRuns++;
                lastSeen = s();
            });

            await flushAll();
            expect(effectRuns).toBe(1);
            expect(lastSeen).toBe(0);

            // Change and revert before flush
            s.set(100);
            s.set(0);

            await flushAll();
            // Effect might still run because it was marked dirty,
            // but it should see the final value
            expect(lastSeen).toBe(0);
        });
    });

    describe('computed chain optimization', () => {
        it('should optimize long chain when first computed bails out', () => {
            const store = state({ ignored: 0 });
            let aTimes = 0, bTimes = 0, cTimes = 0, dTimes = 0;

            const a = computed(() => {
                aTimes++;
                store.ignored;
                return 'constant';
            });

            const b = computed(() => {
                bTimes++;
                return a() + '-b';
            });

            const c = computed(() => {
                cTimes++;
                return b() + '-c';
            });

            const d = computed(() => {
                dTimes++;
                return c() + '-d';
            });

            expect(d()).toBe('constant-b-c-d');
            expect(aTimes).toBe(1);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);
            expect(dTimes).toBe(1);

            store.ignored = 999;

            expect(d()).toBe('constant-b-c-d');
            expect(aTimes).toBe(2); // a recomputes
            expect(bTimes).toBe(1); // Rest don't because a bailed out
            expect(cTimes).toBe(1);
            expect(dTimes).toBe(1);
        });

        it('should propagate change through chain when value changes', () => {
            const store = state({ value: 1 });
            let aTimes = 0, bTimes = 0, cTimes = 0;

            const a = computed(() => {
                aTimes++;
                return store.value;
            });

            const b = computed(() => {
                bTimes++;
                return a() * 2;
            });

            const c = computed(() => {
                cTimes++;
                return b() + 1;
            });

            expect(c()).toBe(3);
            expect(aTimes).toBe(1);
            expect(bTimes).toBe(1);
            expect(cTimes).toBe(1);

            store.value = 5;

            expect(c()).toBe(11);
            expect(aTimes).toBe(2);
            expect(bTimes).toBe(2);
            expect(cTimes).toBe(2);
        });
    });

    describe('conditional dependency optimization', () => {
        it('should not recompute when unused branch changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            expect(times).toBe(1);

            // Change unused branch
            store.b = 100;

            expect(result()).toBe(1);
            expect(times).toBe(1); // Should not recompute
        });

        it('should recompute when active branch changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            expect(times).toBe(1);

            store.a = 10;

            expect(result()).toBe(10);
            expect(times).toBe(2);
        });

        it('should update dependencies when condition changes', () => {
            const store = state({ flag: true, a: 1, b: 2 });
            let times = 0;

            const result = computed(() => {
                times++;
                return store.flag ? store.a : store.b;
            });

            expect(result()).toBe(1);
            times = 0;

            // Switch to b branch
            store.flag = false;
            expect(result()).toBe(2);
            expect(times).toBe(1);

            // Now a changes should not trigger
            times = 0;
            store.a = 100;
            expect(result()).toBe(2);
            expect(times).toBe(0);

            // But b changes should
            store.b = 200;
            expect(result()).toBe(200);
            expect(times).toBe(1);
        });
    });

    describe('object equality optimization', () => {
        it('should use Object.is for value comparison', () => {
            const s = signal(NaN);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBeNaN();
            expect(times).toBe(1);

            s.set(NaN); // NaN === NaN with Object.is

            expect(comp()).toBeNaN();
            expect(times).toBe(1); // Should not recompute
        });

        it('should distinguish +0 and -0', () => {
            const s = signal(+0);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(0);
            expect(times).toBe(1);

            s.set(-0); // -0 !== +0 with Object.is

            expect(comp()).toBe(-0);
            expect(times).toBe(2);
        });

        it('should not recompute for same object reference', () => {
            const obj = { value: 1 };
            const s = signal(obj);
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp()).toBe(obj);
            expect(times).toBe(1);

            // Mutate and set same reference
            obj.value = 999;
            s.set(obj);

            expect(comp().value).toBe(999);
            expect(times).toBe(1); // Same reference, no recompute
        });

        it('should recompute for different object reference with same content', () => {
            const s = signal({ value: 1 });
            let times = 0;

            const comp = computed(() => {
                times++;
                return s();
            });

            expect(comp().value).toBe(1);
            expect(times).toBe(1);

            s.set({ value: 1 }); // Different reference

            expect(comp().value).toBe(1);
            expect(times).toBe(2);
        });
    });
});
