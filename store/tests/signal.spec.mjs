import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    // First yield to microtask queue to let scheduled effects be queued
    await Promise.resolve();
    // Then flush any pending effects
    flushEffects();
    await flushPromises();
}

describe('signal', () => {
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

    describe('basic functionality', () => {
        it('creates a signal with initial value', () => {
            const s = signal(10);
            expect(s()).toBe(10);
        });

        it('creates a signal without initial value (undefined)', () => {
            const s = signal();
            expect(s()).toBe(undefined);
        });

        it('sets a new value', () => {
            const s = signal(1);
            s.set(2);
            expect(s()).toBe(2);
        });

        it('sets value to null', () => {
            const s = signal(/** @type {number | null} */ (5));
            s.set(null);
            expect(s()).toBe(null);
        });

        it('sets value to undefined', () => {
            const s = signal(5);
            // @ts-expect-error Testing setting undefined on a number signal
            s.set(undefined);
            expect(s()).toBe(undefined);
        });
    });

    describe('with effect', () => {
        it('triggers effect on value change', async () => {
            const subscriber = vi.fn();
            const s = signal(0);

            effect(() => {
                subscriber(s());
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber).toHaveBeenCalledWith(0);

            s.set(1);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
            expect(subscriber).toHaveBeenCalledWith(1);
        });

        it('does not trigger effect when value is the same', async () => {
            const subscriber = vi.fn();
            const s = signal(5);

            effect(() => {
                subscriber(s());
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            s.set(5);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('handles multiple signals in one effect', async () => {
            const subscriber = vi.fn();
            const a = signal(1);
            const b = signal(2);

            effect(() => {
                subscriber(a() + b());
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
            expect(subscriber).toHaveBeenCalledWith(3);

            a.set(10);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
            expect(subscriber).toHaveBeenCalledWith(12);

            b.set(20);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(3);
            expect(subscriber).toHaveBeenCalledWith(30);
        });

        it('handles multiple effects on same signal', async () => {
            const subscriber1 = vi.fn();
            const subscriber2 = vi.fn();
            const s = signal(0);

            effect(() => {
                subscriber1(s());
            });

            effect(() => {
                subscriber2(s() * 2);
            });

            await flushAll();
            expect(subscriber1).toHaveBeenCalledWith(0);
            expect(subscriber2).toHaveBeenCalledWith(0);

            s.set(5);
            await flushAll();
            expect(subscriber1).toHaveBeenCalledWith(5);
            expect(subscriber2).toHaveBeenCalledWith(10);
        });

        it('dispose stops effect updates', async () => {
            const subscriber = vi.fn();
            const s = signal(0);

            const dispose = effect(() => {
                subscriber(s());
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            dispose();

            s.set(1);
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });
    });

    describe('with computed', () => {
        it('computed reacts to signal changes', () => {
            const s = signal(5);
            const doubled = computed(() => s() * 2);

            expect(doubled()).toBe(10);

            s.set(10);
            expect(doubled()).toBe(20);
        });

        it('computed with multiple signals', () => {
            const a = signal(2);
            const b = signal(3);
            const sum = computed(() => a() + b());

            expect(sum()).toBe(5);

            a.set(10);
            expect(sum()).toBe(13);

            b.set(7);
            expect(sum()).toBe(17);
        });

        it('chained computeds with signal', () => {
            const s = signal(1);
            const doubled = computed(() => s() * 2);
            const quadrupled = computed(() => doubled() * 2);

            expect(quadrupled()).toBe(4);

            s.set(5);
            expect(quadrupled()).toBe(20);
        });
    });

    describe('with string values', () => {
        it('handles string signals', () => {
            const s = signal('hello');
            expect(s()).toBe('hello');

            s.set('world');
            expect(s()).toBe('world');
        });

        it('effect reacts to string change', async () => {
            const subscriber = vi.fn();
            const s = signal('initial');

            effect(() => {
                subscriber(s());
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('initial');

            s.set('changed');
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('changed');
        });
    });

    describe('with object values', () => {
        it('handles object signals', () => {
            const obj1 = /** @type {{ a?: number; b?: number }} */ ({ a: 1 });
            const obj2 = { b: 2 };
            const s = signal(obj1);

            expect(s()).toBe(obj1);

            s.set(obj2);
            expect(s()).toBe(obj2);
        });

        it('triggers update on object reference change', async () => {
            const subscriber = vi.fn();
            const s = signal({ value: 1 });

            effect(() => {
                subscriber(s().value);
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(1);

            s.set({ value: 2 });
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(2);
        });

        it('does not trigger update on same object reference', async () => {
            const subscriber = vi.fn();
            const obj = { value: 1 };
            const s = signal(obj);

            effect(() => {
                subscriber(s().value);
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            // Mutate the object but set same reference
            obj.value = 2;
            s.set(obj);
            await flushAll();
            // Should not trigger because reference is the same
            expect(subscriber).toHaveBeenCalledTimes(1);
        });
    });

    describe('state', () => {
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

        describe('basic functionality', () => {
            it('creates a state with initial value', () => {
                const s = state({ count: 10 });
                expect(s.count).toBe(10);
            });

            it('creates a state without initial value (empty object)', () => {
                const s = state();
                expect(s).toEqual({});
            });

            it('sets a new value', () => {
                const s = state({ count: 1 });
                s.count = 2;
                expect(s.count).toBe(2);
            });

            it('sets value to null', () => {
                const s = state({ value: /** @type {number | null} */ (5) });
                s.value = null;
                expect(s.value).toBe(null);
            });

            it('sets value to undefined', () => {
                const s = state({ value: 5 });
                // @ts-expect-error Testing setting undefined
                s.value = undefined;
                expect(s.value).toBe(undefined);
            });
        });

        describe('with effect', () => {
            it('triggers effect on value change', async () => {
                const subscriber = vi.fn();
                const s = state({ count: 0 });

                effect(() => {
                    subscriber(s.count);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);
                expect(subscriber).toHaveBeenCalledWith(0);

                s.count = 1;
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(2);
                expect(subscriber).toHaveBeenCalledWith(1);
            });

            it('does not trigger effect when value is the same', async () => {
                const subscriber = vi.fn();
                const s = state({ count: 5 });

                effect(() => {
                    subscriber(s.count);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);

                s.count = 5;
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);
            });

            it('handles multiple properties in one effect', async () => {
                const subscriber = vi.fn();
                const s = state({ a: 1, b: 2 });

                effect(() => {
                    subscriber(s.a + s.b);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);
                expect(subscriber).toHaveBeenCalledWith(3);

                s.a = 10;
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(2);
                expect(subscriber).toHaveBeenCalledWith(12);

                s.b = 20;
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(3);
                expect(subscriber).toHaveBeenCalledWith(30);
            });

            it('handles multiple effects on same state', async () => {
                const subscriber1 = vi.fn();
                const subscriber2 = vi.fn();
                const s = state({ count: 0 });

                effect(() => {
                    subscriber1(s.count);
                });

                effect(() => {
                    subscriber2(s.count * 2);
                });

                await flushAll();
                expect(subscriber1).toHaveBeenCalledWith(0);
                expect(subscriber2).toHaveBeenCalledWith(0);

                s.count = 5;
                await flushAll();
                expect(subscriber1).toHaveBeenCalledWith(5);
                expect(subscriber2).toHaveBeenCalledWith(10);
            });

            it('dispose stops effect updates', async () => {
                const subscriber = vi.fn();
                const s = state({ count: 0 });

                const dispose = effect(() => {
                    subscriber(s.count);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);

                dispose();

                s.count = 1;
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);
            });
        });

        describe('with computed', () => {
            it('computed reacts to state changes', () => {
                const s = state({ count: 5 });
                const doubled = computed(() => s.count * 2);

                expect(doubled()).toBe(10);

                s.count = 10;
                expect(doubled()).toBe(20);
            });

            it('computed with multiple state properties', () => {
                const s = state({ a: 2, b: 3 });
                const sum = computed(() => s.a + s.b);

                expect(sum()).toBe(5);

                s.a = 10;
                expect(sum()).toBe(13);

                s.b = 7;
                expect(sum()).toBe(17);
            });

            it('chained computeds with state', () => {
                const s = state({ value: 1 });
                const doubled = computed(() => s.value * 2);
                const quadrupled = computed(() => doubled() * 2);

                expect(quadrupled()).toBe(4);

                s.value = 5;
                expect(quadrupled()).toBe(20);
            });
        });

        describe('with string values', () => {
            it('handles string state properties', () => {
                const s = state({ text: 'hello' });
                expect(s.text).toBe('hello');

                s.text = 'world';
                expect(s.text).toBe('world');
            });

            it('effect reacts to string change', async () => {
                const subscriber = vi.fn();
                const s = state({ text: 'initial' });

                effect(() => {
                    subscriber(s.text);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledWith('initial');

                s.text = 'changed';
                await flushAll();
                expect(subscriber).toHaveBeenCalledWith('changed');
            });
        });

        describe('with object values', () => {
            it('handles nested object state', () => {
                const s = state({ nested: { a: 1 } });

                expect(s.nested.a).toBe(1);

                s.nested.a = 2;
                expect(s.nested.a).toBe(2);
            });

            it('triggers update on nested object property change', async () => {
                const subscriber = vi.fn();
                const s = state({ nested: { value: 1 } });

                effect(() => {
                    subscriber(s.nested.value);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledWith(1);

                s.nested.value = 2;
                await flushAll();
                expect(subscriber).toHaveBeenCalledWith(2);
            });

            it('triggers update when nested object is replaced', async () => {
                const subscriber = vi.fn();
                const s = state({ nested: { value: 1 } });

                effect(() => {
                    subscriber(s.nested.value);
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);

                s.nested = { value: 2 };
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(2);
                expect(subscriber).toHaveBeenCalledWith(2);
            });
        });

        describe('with boolean values', () => {
            it('handles boolean state properties', () => {
                const s = state({ flag: true });
                expect(s.flag).toBe(true);

                s.flag = false;
                expect(s.flag).toBe(false);
            });

            it('conditional effect based on boolean state', async () => {
                const subscriber = vi.fn();
                const s = state({ flag: true, value: 'active' });

                effect(() => {
                    if (s.flag) {
                        subscriber(s.value);
                    } else {
                        subscriber('inactive');
                    }
                });

                await flushAll();
                expect(subscriber).toHaveBeenCalledWith('active');

                s.flag = false;
                await flushAll();
                expect(subscriber).toHaveBeenCalledWith('inactive');
            });
        });
    });

    describe('with boolean values', () => {
        it('handles boolean signals', () => {
            const s = signal(true);
            expect(s()).toBe(true);

            s.set(false);
            expect(s()).toBe(false);
        });

        it('conditional effect based on boolean signal', async () => {
            const subscriber = vi.fn();
            const flag = signal(true);
            const value = signal('active');

            effect(() => {
                if (flag()) {
                    subscriber(value());
                } else {
                    subscriber('inactive');
                }
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('active');

            flag.set(false);
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith('inactive');
        });
    });
});
