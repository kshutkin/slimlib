import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, setScheduler, signal, state } from '../src/index.js';

function source(kind, initial) {
    if (kind === 'signal') {
        const read = signal(initial);
        return { read, write: read.set };
    }
    const value = state({ current: initial });
    return {
        read: () => value.current,
        write: next => {
            value.current = next;
        },
    };
}

let testScope;
beforeEach(() => {
    setScheduler(queueMicrotask);
    testScope = scope();
    setActiveScope(testScope);
});
afterEach(() => {
    testScope();
    setActiveScope(undefined);
    setScheduler(queueMicrotask);
    flushEffects();
});

describe('cached computed promotion', () => {
    for (const kind of ['signal', 'state']) {
        for (const resubscribe of [false, true]) {
            for (const eager of [0, 1]) {
                it(`validates before subscribing (${kind}, resubscribe=${resubscribe}, eager=${eager})`, () => {
                    const input = source(kind, 1);
                    const doubled = computed(() => input.read() * 2);
                    if (resubscribe) {
                        const stop = effect(() => {
                            doubled();
                        }, 1);
                        stop();
                    } else {
                        expect(doubled()).toBe(2);
                    }
                    input.write(2);
                    let observed;
                    effect(() => {
                        observed = doubled();
                    }, eager);
                    flushEffects();
                    expect(observed).toBe(4);
                });
            }
        }
    }

    it('subscribes to the current conditional branch when becoming live', () => {
        const chooseA = signal(true);
        const a = signal(1);
        const b = signal(10);
        const selected = computed(() => (chooseA() ? a() : b()));
        expect(selected()).toBe(1);
        chooseA.set(false);
        let observed;
        effect(() => {
            observed = selected();
        }, 1);
        b.set(20);
        flushEffects();
        expect(observed).toBe(20);
    });

    it('preserves cached identity when a source reverts before subscription', () => {
        const input = signal(1);
        let runs = 0;
        const value = computed(() => {
            ++runs;
            return { value: input() };
        });
        const cached = value();
        input.set(2);
        input.set(1);
        let observed;
        effect(() => {
            observed = value();
        }, 1);
        expect(observed).toBe(cached);
        expect(runs).toBe(1);
    });

    it('validates an entire cached chain before subscribing', () => {
        const input = signal(1);
        const a = computed(() => input() * 2);
        const b = computed(() => a() + 1);
        const c = computed(() => b() + 1);
        expect(c()).toBe(4);
        input.set(2);
        let observed;
        effect(() => {
            observed = c();
        }, 1);
        expect(observed).toBe(6);
        input.set(3);
        flushEffects();
        expect(observed).toBe(8);
    });

    it('keeps error subscriptions so the computed can recover', () => {
        const input = signal(1);
        let runs = 0;
        const value = computed(() => {
            ++runs;
            if (input() < 0) throw new Error('negative');
            return input();
        });
        expect(value()).toBe(1);
        input.set(-1);
        const observations = [];
        effect(() => {
            try {
                observations.push(value());
            } catch (error) {
                observations.push(error.message);
            }
        }, 1);
        expect(observations).toEqual(['negative']);
        expect(runs).toBe(2);
        input.set(2);
        flushEffects();
        expect(observations).toEqual(['negative', 2]);
        expect(runs).toBe(3);
    });

    it('does not hide property polling errors during subscription', () => {
        const input = state({ value: 1 });
        const value = computed(() => input.value);
        expect(value()).toBe(1);
        Object.defineProperty(input, 'value', {
            get() {
                throw new Error('unavailable');
            },
        });
        let observed;
        effect(() => {
            try {
                observed = value();
            } catch (error) {
                observed = error.message;
            }
        }, 1);
        expect(observed).toBe('unavailable');
    });
});

describe('synchronous propagation consistency', () => {
    it('invalidates all properties changed by a state method before flushing', () => {
        setScheduler(callback => callback());
        const input = state({
            a: 1,
            b: 1,
            increment() {
                this.a++;
                this.b++;
            },
        });
        const a = computed(() => input.a);
        const b = computed(() => input.b);
        const observations = [];
        effect(() => {
            observations.push([a(), b()]);
        }, 1);
        input.increment();
        expect(observations).toEqual([
            [1, 1],
            [2, 2],
        ]);
    });

    it('notifies a consumer once when it reads a source more than once', () => {
        setScheduler(callback => callback());
        const a = signal(0);
        const b = signal(0);
        let runs = 0;
        effect(() => {
            ++runs;
            a();
            b();
            a();
        }, 1);
        a.set(1);
        expect(runs).toBe(2);
    });

    for (const kind of ['signal', 'state']) {
        it(`never mixes old computed and new direct values (${kind})`, () => {
            setScheduler(callback => callback());
            const input = source(kind, 1);
            const doubled = computed(() => input.read() * 2);
            const observations = [];
            effect(() => {
                observations.push([input.read(), doubled()]);
            }, 1);
            input.write(2);
            expect(observations.at(-1)).toEqual([2, 4]);
            // Duplicate consistent observations are allowed; contradictory pairs are not.
            expect(observations.every(([value, double]) => double === value * 2)).toBe(true);
        });

        it(`never mixes sibling computed versions in a diamond (${kind})`, () => {
            setScheduler(callback => callback());
            const input = source(kind, 1);
            const doubled = computed(() => input.read() * 2);
            const tripled = computed(() => input.read() * 3);
            const observations = [];
            effect(() => {
                observations.push([doubled(), tripled()]);
            }, 1);
            input.write(2);
            expect(observations.at(-1)).toEqual([4, 6]);
            expect(observations.every(([double, triple]) => double * 3 === triple * 2)).toBe(true);
        });
    }
});

describe('dependency tracking after caught errors', () => {
    for (const propertyGetter of [true, false]) {
        it(`tracks fallback after an upstream error (propertyGetter=${propertyGetter})`, () => {
            const input = state({
                broken: false,
                get value() {
                    if (this.broken) throw new Error('unavailable');
                    return 1;
                },
                fail() {
                    this.broken = true;
                },
            });
            const bad = computed(() => {
                if (propertyGetter) return input.value;
                if (input.broken) throw new Error('unavailable');
                return 1;
            });
            expect(bad()).toBe(1);
            input.fail();
            const fallback = signal(0);
            const recovered = computed(() => {
                try {
                    return bad();
                } catch {
                    return fallback();
                }
            });
            expect(recovered()).toBe(0);
            fallback.set(1);
            expect(recovered()).toBe(1);
        });
    }
});
