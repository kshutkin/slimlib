import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('error recovery', () => {
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

    describe('computed error handling', () => {
        it('should keep graph consistent on errors during activation', () => {
            const store = state({ a: 0 });
            const b = computed(() => {
                throw new Error('fail');
            });
            const c = computed(() => store.a);

            expect(() => b()).toThrow('fail');

            store.a = 1;
            expect(c()).toBe(1);
        });

        it('should keep graph consistent on errors in computeds', () => {
            const store = state({ a: 0 });
            const b = computed(() => {
                if (store.a === 1) throw new Error('fail');
                return store.a;
            });
            const c = computed(() => b());

            expect(c()).toBe(0);

            store.a = 1;
            expect(() => b()).toThrow('fail');

            store.a = 2;
            expect(c()).toBe(2);
        });

        it('should throw same error on repeated access', () => {
            const store = state({ value: 0 });
            let callCount = 0;

            const comp = computed(() => {
                callCount++;
                if (store.value === 1) throw new Error('computed error');
                return store.value;
            });

            expect(comp()).toBe(0);
            expect(callCount).toBe(1);

            store.value = 1;

            expect(() => comp()).toThrow('computed error');
            expect(() => comp()).toThrow('computed error');
        });

        it('should recover after error-causing value is fixed', () => {
            const store = state({ value: 'ok' });

            const comp = computed(() => {
                if (store.value === 'error') throw new Error('bad value');
                return store.value.toUpperCase();
            });

            expect(comp()).toBe('OK');

            store.value = 'error';
            expect(() => comp()).toThrow('bad value');

            store.value = 'fixed';
            expect(comp()).toBe('FIXED');
        });

        it('should propagate error through computed chain', () => {
            const store = state({ value: 0 });

            const first = computed(() => {
                if (store.value === 1) throw new Error('first error');
                return store.value;
            });

            const second = computed(() => first() * 2);
            const third = computed(() => second() + 1);

            expect(third()).toBe(1);

            store.value = 1;
            expect(() => third()).toThrow('first error');

            store.value = 5;
            expect(third()).toBe(11);
        });

        it('should isolate errors between independent computed chains', () => {
            const store = state({ a: 0, b: 0 });

            const chainA = computed(() => {
                if (store.a === 1) throw new Error('chain A error');
                return store.a;
            });

            const chainB = computed(() => store.b * 2);

            expect(chainA()).toBe(0);
            expect(chainB()).toBe(0);

            store.a = 1;
            store.b = 5;

            expect(() => chainA()).toThrow('chain A error');
            expect(chainB()).toBe(10); // Should still work
        });
    });

    describe('effect error handling', () => {
        it('should continue running other effects after one throws', async () => {
            const store = state({ value: 0 });
            let effect1Ran = false;
            let effect2Ran = false;
            let effect3Ran = false;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                store.value;
                effect1Ran = true;
            });

            effect(() => {
                store.value;
                if (store.value === 1) throw new Error('effect 2 error');
                effect2Ran = true;
            });

            effect(() => {
                store.value;
                effect3Ran = true;
            });

            await flushAll();
            expect(effect1Ran).toBe(true);
            expect(effect2Ran).toBe(true);
            expect(effect3Ran).toBe(true);

            effect1Ran = effect2Ran = effect3Ran = false;
            store.value = 1;

            await flushAll();
            expect(effect1Ran).toBe(true);
            // effect2 throws but effect3 should still run
            expect(effect3Ran).toBe(true);

            consoleError.mockRestore();
        });

        it('should run cleanup even if effect throws', async () => {
            const store = state({ value: 0 });
            let cleanupRan = false;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                store.value;
                if (store.value === 1) throw new Error('effect error');
                return () => {
                    cleanupRan = true;
                };
            });

            await flushAll();
            expect(cleanupRan).toBe(false);

            store.value = 1;
            await flushAll();
            expect(cleanupRan).toBe(true);

            consoleError.mockRestore();
        });

        it('should handle effect that reads errored computed', async () => {
            const store = state({ value: 0 });
            let lastValue = -1;
            let errorCaught = false;

            const comp = computed(() => {
                if (store.value === 1) throw new Error('computed error');
                return store.value;
            });

            effect(() => {
                try {
                    lastValue = comp();
                } catch {
                    errorCaught = true;
                }
            });

            await flushAll();
            expect(lastValue).toBe(0);
            expect(errorCaught).toBe(false);

            store.value = 1;
            await flushAll();
            expect(errorCaught).toBe(true);

            store.value = 2;
            await flushAll();
            expect(lastValue).toBe(2);
        });
    });

    describe('scope error handling', () => {
        it('should dispose all effects even if one throws during disposal', async () => {
            const store = state({ value: 0 });
            let effect1Disposed = false;
            let effect2Disposed = false;
            let effect3Disposed = false;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const innerScope = scope();
            innerScope(() => {
                effect(() => {
                    store.value;
                    return () => {
                        effect1Disposed = true;
                    };
                });

                effect(() => {
                    store.value;
                    return () => {
                        effect2Disposed = true;
                        throw new Error('cleanup error');
                    };
                });

                effect(() => {
                    store.value;
                    return () => {
                        effect3Disposed = true;
                    };
                });
            });

            await flushAll();

            innerScope();

            // we just logging, not throwing
            // expect(() => innerScope()).toThrow();

            expect(effect1Disposed).toBe(true);
            expect(effect2Disposed).toBe(true);
            expect(effect3Disposed).toBe(true);

            consoleError.mockRestore();
        });

        it('should continue disposing children even if onDispose callback throws', async () => {
            /**
             * @type {string[]}
             */
            const order = [];

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const parent = scope();
            parent(onDispose => {
                onDispose(() => {
                    order.push('parent cleanup');
                    throw new Error('parent cleanup error');
                });

                const child = scope();
                child(onDispose => {
                    onDispose(() => {
                        order.push('child cleanup');
                    });
                });
            });

            parent();

            // expect(() => parent()).toThrow();
            // we just logging, not throwing

            expect(order).toContain('parent cleanup');
            expect(order).toContain('child cleanup');

            consoleError.mockRestore();
        });
    });

    describe('error recovery with batching', () => {
        it('should handle error in one effect without affecting batched updates', async () => {
            const store = state({ a: 0, b: 0 });
            let effectARan = 0;
            let effectBRan = 0;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                effectARan++;
                if (store.a === 1) throw new Error('effect A error');
            });

            effect(() => {
                effectBRan++;
                store.b;
            });

            await flushAll();
            expect(effectARan).toBe(1);
            expect(effectBRan).toBe(1);

            // Batch both changes
            store.a = 1;
            store.b = 1;

            await flushAll();
            // Both effects should have been scheduled and attempted
            expect(effectARan).toBe(2);
            expect(effectBRan).toBe(2);

            consoleError.mockRestore();
        });

        it('should continue processing batch after error', async () => {
            const store = state({ value: 0 });
            let lastSeenValue = -1;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                if (store.value === 1) throw new Error('transient error');
            });

            effect(() => {
                lastSeenValue = store.value;
            });

            await flushAll();
            expect(lastSeenValue).toBe(0);

            store.value = 1;
            await flushAll();
            expect(lastSeenValue).toBe(1);

            store.value = 2;
            await flushAll();
            expect(lastSeenValue).toBe(2);

            consoleError.mockRestore();
        });
    });

    describe('diamond pattern with errors', () => {
        it('should handle error in one branch of diamond', () => {
            //     A
            //   /   \
            //  B     C (throws)
            //   \   /
            //     D
            const store = state({ a: 0 });

            const b = computed(() => store.a * 2);
            const c = computed(() => {
                if (store.a === 1) throw new Error('branch C error');
                return store.a * 3;
            });
            const d = computed(() => b() + c());

            expect(d()).toBe(0);

            store.a = 1;
            expect(() => d()).toThrow('branch C error');

            store.a = 2;
            expect(d()).toBe(10); // 4 + 6
        });

        it('should recover diamond when error branch fixes itself', () => {
            const store = state({ trigger: false, value: 10 });

            const left = computed(() => {
                if (store.trigger) throw new Error('left error');
                return store.value;
            });
            const right = computed(() => store.value * 2);
            const merged = computed(() => left() + right());

            expect(merged()).toBe(30);

            store.trigger = true;
            expect(() => merged()).toThrow('left error');

            store.trigger = false;
            expect(merged()).toBe(30);
        });
    });

    describe('error in conditional dependencies', () => {
        it('should handle error when switching conditional branch', () => {
            const store = state({ useA: true, a: 1, b: 2 });

            const comp = computed(() => {
                if (store.useA) {
                    return store.a;
                } else {
                    if (store.b === 2) throw new Error('b is 2');
                    return store.b;
                }
            });

            expect(comp()).toBe(1);

            store.useA = false;
            expect(() => comp()).toThrow('b is 2');

            store.b = 3;
            expect(comp()).toBe(3);

            store.useA = true;
            expect(comp()).toBe(1);
        });

        it('should not throw for unused error branch', () => {
            const store = state({ condition: true, errorValue: 'error' });

            const comp = computed(() => {
                if (store.condition) {
                    return 'safe';
                } else {
                    if (store.errorValue === 'error') throw new Error('would error');
                    return store.errorValue;
                }
            });

            expect(comp()).toBe('safe');

            // Changing errorValue should not cause recomputation when condition is true
            store.errorValue = 'still error';
            expect(comp()).toBe('safe');
        });
    });
});

describe('error recovery with signals', () => {
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

    describe('computed error handling', () => {
        it('should keep graph consistent on errors during activation', () => {
            const a = signal(0);
            const b = computed(() => {
                throw new Error('fail');
            });
            const c = computed(() => a());

            expect(() => b()).toThrow('fail');

            a.set(1);
            expect(c()).toBe(1);
        });

        it('should keep graph consistent on errors in computeds', () => {
            const a = signal(0);
            const b = computed(() => {
                if (a() === 1) throw new Error('fail');
                return a();
            });
            const c = computed(() => b());

            expect(c()).toBe(0);

            a.set(1);
            expect(() => b()).toThrow('fail');

            a.set(2);
            expect(c()).toBe(2);
        });

        it('should throw same error on repeated access', () => {
            const value = signal(0);
            let callCount = 0;

            const comp = computed(() => {
                callCount++;
                if (value() === 1) throw new Error('computed error');
                return value();
            });

            expect(comp()).toBe(0);
            expect(callCount).toBe(1);

            value.set(1);

            expect(() => comp()).toThrow('computed error');
            expect(() => comp()).toThrow('computed error');
        });

        it('should recover after error-causing value is fixed', () => {
            const value = signal('ok');

            const comp = computed(() => {
                if (value() === 'error') throw new Error('bad value');
                return value().toUpperCase();
            });

            expect(comp()).toBe('OK');

            value.set('error');
            expect(() => comp()).toThrow('bad value');

            value.set('fixed');
            expect(comp()).toBe('FIXED');
        });

        it('should propagate error through computed chain', () => {
            const value = signal(0);

            const first = computed(() => {
                if (value() === 1) throw new Error('first error');
                return value();
            });

            const second = computed(() => first() * 2);
            const third = computed(() => second() + 1);

            expect(third()).toBe(1);

            value.set(1);
            expect(() => third()).toThrow('first error');

            value.set(5);
            expect(third()).toBe(11);
        });

        it('should isolate errors between independent computed chains', () => {
            const a = signal(0);
            const b = signal(0);

            const chainA = computed(() => {
                if (a() === 1) throw new Error('chain A error');
                return a();
            });

            const chainB = computed(() => b() * 2);

            expect(chainA()).toBe(0);
            expect(chainB()).toBe(0);

            a.set(1);
            b.set(5);

            expect(() => chainA()).toThrow('chain A error');
            expect(chainB()).toBe(10); // Should still work
        });
    });

    describe('effect error handling', () => {
        it('should continue running other effects after one throws', async () => {
            const value = signal(0);
            let effect1Ran = false;
            let effect2Ran = false;
            let effect3Ran = false;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                value();
                effect1Ran = true;
            });

            effect(() => {
                value();
                if (value() === 1) throw new Error('effect 2 error');
                effect2Ran = true;
            });

            effect(() => {
                value();
                effect3Ran = true;
            });

            await flushAll();
            expect(effect1Ran).toBe(true);
            expect(effect2Ran).toBe(true);
            expect(effect3Ran).toBe(true);

            effect1Ran = effect2Ran = effect3Ran = false;
            value.set(1);

            await flushAll();
            expect(effect1Ran).toBe(true);
            // effect2 throws but effect3 should still run
            expect(effect3Ran).toBe(true);

            consoleError.mockRestore();
        });

        it('should run cleanup even if effect throws', async () => {
            const value = signal(0);
            let cleanupRan = false;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                value();
                if (value() === 1) throw new Error('effect error');
                return () => {
                    cleanupRan = true;
                };
            });

            await flushAll();
            expect(cleanupRan).toBe(false);

            value.set(1);
            await flushAll();
            expect(cleanupRan).toBe(true);

            consoleError.mockRestore();
        });

        it('should handle effect that reads errored computed', async () => {
            const value = signal(0);
            let lastValue = -1;
            let errorCaught = false;

            const comp = computed(() => {
                if (value() === 1) throw new Error('computed error');
                return value();
            });

            effect(() => {
                try {
                    lastValue = comp();
                } catch {
                    errorCaught = true;
                }
            });

            await flushAll();
            expect(lastValue).toBe(0);
            expect(errorCaught).toBe(false);

            value.set(1);
            await flushAll();
            expect(errorCaught).toBe(true);

            value.set(2);
            await flushAll();
            expect(lastValue).toBe(2);
        });
    });

    describe('error recovery with batching', () => {
        it('should handle error in one effect without affecting batched updates', async () => {
            const a = signal(0);
            const b = signal(0);
            let effectARan = 0;
            let effectBRan = 0;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                effectARan++;
                if (a() === 1) throw new Error('effect A error');
            });

            effect(() => {
                effectBRan++;
                b();
            });

            await flushAll();
            expect(effectARan).toBe(1);
            expect(effectBRan).toBe(1);

            // Batch both changes
            a.set(1);
            b.set(1);

            await flushAll();
            // Both effects should have been scheduled and attempted
            expect(effectARan).toBe(2);
            expect(effectBRan).toBe(2);

            consoleError.mockRestore();
        });

        it('should continue processing batch after error', async () => {
            const value = signal(0);
            let lastSeenValue = -1;

            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            effect(() => {
                if (value() === 1) throw new Error('transient error');
            });

            effect(() => {
                lastSeenValue = value();
            });

            await flushAll();
            expect(lastSeenValue).toBe(0);

            value.set(1);
            await flushAll();
            expect(lastSeenValue).toBe(1);

            value.set(2);
            await flushAll();
            expect(lastSeenValue).toBe(2);

            consoleError.mockRestore();
        });
    });

    describe('diamond pattern with errors', () => {
        it('should handle error in one branch of diamond', () => {
            //     A
            //   /   \
            //  B     C (throws)
            //   \   /
            //     D
            const a = signal(0);

            const b = computed(() => a() * 2);
            const c = computed(() => {
                if (a() === 1) throw new Error('branch C error');
                return a() * 3;
            });
            const d = computed(() => b() + c());

            expect(d()).toBe(0);

            a.set(1);
            expect(() => d()).toThrow('branch C error');

            a.set(2);
            expect(d()).toBe(10); // 4 + 6
        });

        it('should recover diamond when error branch fixes itself', () => {
            const trigger = signal(false);
            const value = signal(10);

            const left = computed(() => {
                if (trigger()) throw new Error('left error');
                return value();
            });
            const right = computed(() => value() * 2);
            const merged = computed(() => left() + right());

            expect(merged()).toBe(30);

            trigger.set(true);
            expect(() => merged()).toThrow('left error');

            trigger.set(false);
            expect(merged()).toBe(30);
        });
    });

    describe('error in conditional dependencies', () => {
        it('should handle error when switching conditional branch', () => {
            const useA = signal(true);
            const a = signal(1);
            const b = signal(2);

            const comp = computed(() => {
                if (useA()) {
                    return a();
                } else {
                    if (b() === 2) throw new Error('b is 2');
                    return b();
                }
            });

            expect(comp()).toBe(1);

            useA.set(false);
            expect(() => comp()).toThrow('b is 2');

            b.set(3);
            expect(comp()).toBe(3);

            useA.set(true);
            expect(comp()).toBe(1);
        });

        it('should not throw for unused error branch', () => {
            const condition = signal(true);
            const errorValue = signal('error');

            const comp = computed(() => {
                if (condition()) {
                    return 'safe';
                } else {
                    if (errorValue() === 'error') throw new Error('would error');
                    return errorValue();
                }
            });

            expect(comp()).toBe('safe');

            // Changing errorValue should not cause recomputation when condition is true
            errorValue.set('still error');
            expect(comp()).toBe('safe');
        });
    });
});
