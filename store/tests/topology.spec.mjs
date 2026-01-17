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

describe('topology', () => {
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

    describe('graph updates', () => {
        it('should drop A->B->A updates', async () => {
            //     A
            //   / |
            //  B  | <- Looks like a flag doesn't it? :D
            //   \ |
            //     C
            //     |
            //     D
            const store = state({ a: 2 });

            const b = computed(() => store.a - 1);
            const c = computed(() => store.a + b());

            const compute = vi.fn(() => 'd: ' + c());
            const d = computed(compute);

            // Trigger read
            expect(d()).toBe('d: 3');
            expect(compute).toHaveBeenCalledOnce();
            compute.mockClear();

            store.a = 4;
            d();
            expect(compute).toHaveBeenCalledOnce();
        });

        it('should only update every signal once (diamond graph)', async () => {
            // In this scenario "D" should only update once when "A" receives
            // an update. This is sometimes referred to as the "diamond" scenario.
            //     A
            //   /   \
            //  B     C
            //   \   /
            //     D

            const store = state({ a: 'a' });
            const b = computed(() => store.a);
            const c = computed(() => store.a);

            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('a a');
            expect(spy).toHaveBeenCalledOnce();

            store.a = 'aa';
            expect(d()).toBe('aa aa');
            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should only update every signal once (diamond graph + tail)', async () => {
            // "E" will be likely updated twice if our mark+sweep logic is buggy.
            //     A
            //   /   \
            //  B     C
            //   \   /
            //     D
            //     |
            //     E

            const store = state({ a: 'a' });
            const b = computed(() => store.a);
            const c = computed(() => store.a);

            const d = computed(() => b() + ' ' + c());

            const spy = vi.fn(() => d());
            const e = computed(spy);

            expect(e()).toBe('a a');
            expect(spy).toHaveBeenCalledOnce();

            store.a = 'aa';
            expect(e()).toBe('aa aa');
            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should bail out if result is the same', () => {
            // Bail out if value of "B" never changes
            // A->B->C
            const store = state({ a: 'a' });
            const b = computed(() => {
                store.a;
                return 'foo';
            });

            const spy = vi.fn(() => b());
            const c = computed(spy);

            expect(c()).toBe('foo');
            expect(spy).toHaveBeenCalledOnce();

            store.a = 'aa';
            expect(c()).toBe('foo');
            expect(spy).toHaveBeenCalledOnce();
        });

        it('should only update every signal once (jagged diamond graph + tails)', () => {
            // "F" and "G" will be likely updated twice if our mark+sweep logic is buggy.
            //     A
            //   /   \
            //  B     C
            //  |     |
            //  |     D
            //   \   /
            //     E
            //   /   \
            //  F     G
            const store = state({ a: 'a' });

            const b = computed(() => store.a);
            const c = computed(() => store.a);

            const d = computed(() => c());

            const eSpy = vi.fn(() => b() + ' ' + d());
            const e = computed(eSpy);

            const fSpy = vi.fn(() => e());
            const f = computed(fSpy);
            const gSpy = vi.fn(() => e());
            const g = computed(gSpy);

            expect(f()).toBe('a a');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('a a');
            expect(gSpy).toHaveBeenCalledTimes(1);

            eSpy.mockClear();
            fSpy.mockClear();
            gSpy.mockClear();

            store.a = 'b';

            expect(e()).toBe('b b');
            expect(eSpy).toHaveBeenCalledTimes(1);

            expect(f()).toBe('b b');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('b b');
            expect(gSpy).toHaveBeenCalledTimes(1);

            eSpy.mockClear();
            fSpy.mockClear();
            gSpy.mockClear();

            store.a = 'c';

            expect(e()).toBe('c c');
            expect(eSpy).toHaveBeenCalledTimes(1);

            expect(f()).toBe('c c');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('c c');
            expect(gSpy).toHaveBeenCalledTimes(1);
        });

        it('should only subscribe to signals listened to', () => {
            //    *A
            //   /   \
            // *B     C <- we don't listen to C
            const store = state({ a: 'a' });

            const b = computed(() => store.a);
            const spy = vi.fn(() => store.a);
            computed(spy);

            expect(b()).toBe('a');
            expect(spy).not.toHaveBeenCalled();

            store.a = 'aa';
            expect(b()).toBe('aa');
            expect(spy).not.toHaveBeenCalled();
        });

        it('should only subscribe to signals listened to II', async () => {
            // Here both "B" and "C" are active in the beginning, but
            // "B" becomes inactive later. At that point it should
            // not receive any updates anymore.
            //    *A
            //   /   \
            // *B     D <- we don't listen to C
            //  |
            // *C
            const store = state({ a: 'a' });
            const spyB = vi.fn(() => store.a);
            const b = computed(spyB);

            const spyC = vi.fn(() => b());
            const c = computed(spyC);

            const d = computed(() => store.a);

            let result = '';
            const unsub = effect(() => {
                result = c();
            });

            await flushAll();
            expect(result).toBe('a');
            expect(d()).toBe('a');

            spyB.mockClear();
            spyC.mockClear();
            unsub();

            store.a = 'aa';

            expect(spyB).not.toHaveBeenCalled();
            expect(spyC).not.toHaveBeenCalled();
            expect(d()).toBe('aa');
        });

        it('should ensure subs update even if one dep unmarks it', async () => {
            // In this scenario "C" always returns the same value. When "A"
            // changes, "B" will update, then "C" at which point its update
            // to "D" will be unmarked. But "D" must still update because
            // "B" marked it. If "D" isn't updated, then we have a bug.
            //     A
            //   /   \
            //  B     *C <- returns same value every time
            //   \   /
            //     D
            const store = state({ a: 'a' });
            const b = computed(() => store.a);
            const c = computed(() => {
                store.a;
                return 'c';
            });
            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('a c');
            spy.mockClear();

            store.a = 'aa';
            d();
            expect(spy).toHaveReturnedWith('aa c');
        });

        it('should ensure subs update even if two deps unmark it', () => {
            // In this scenario both "C" and "D" always return the same
            // value. But "E" must still update because "A" marked it.
            // If "E" isn't updated, then we have a bug.
            //     A
            //   / | \
            //  B *C *D
            //   \ | /
            //     E
            const store = state({ a: 'a' });
            const b = computed(() => store.a);
            const c = computed(() => {
                store.a;
                return 'c';
            });
            const d = computed(() => {
                store.a;
                return 'd';
            });
            const spy = vi.fn(() => b() + ' ' + c() + ' ' + d());
            const e = computed(spy);

            expect(e()).toBe('a c d');
            spy.mockClear();

            store.a = 'aa';
            e();
            expect(spy).toHaveReturnedWith('aa c d');
        });

        it('should support lazy branches', () => {
            const store = state({ a: 0 });
            const b = computed(() => store.a);
            const c = computed(() => (store.a > 0 ? store.a : b()));

            expect(c()).toBe(0);
            store.a = 1;
            expect(c()).toBe(1);

            store.a = 0;
            expect(c()).toBe(0);
        });

        it('should not update a sub if all deps unmark it', () => {
            // In this scenario "B" and "C" always return the same value. When "A"
            // changes, "D" should not update.
            //     A
            //   /   \
            // *B     *C
            //   \   /
            //     D
            const store = state({ a: 'a' });
            const b = computed(() => {
                store.a;
                return 'b';
            });
            const c = computed(() => {
                store.a;
                return 'c';
            });
            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('b c');
            spy.mockClear();

            store.a = 'aa';
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
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
    });
});

describe('topology with signals', () => {
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

    describe('graph updates', () => {
        it('should drop A->B->A updates', async () => {
            //     A
            //   / |
            //  B  | <- Looks like a flag doesn't it? :D
            //   \ |
            //     C
            //     |
            //     D
            const a = signal(2);

            const b = computed(() => a() - 1);
            const c = computed(() => a() + b());

            const compute = vi.fn(() => 'd: ' + c());
            const d = computed(compute);

            // Trigger read
            expect(d()).toBe('d: 3');
            expect(compute).toHaveBeenCalledOnce();
            compute.mockClear();

            a.set(4);
            d();
            expect(compute).toHaveBeenCalledOnce();
        });

        it('should only update every signal once (diamond graph)', async () => {
            //     A
            //   /   \
            //  B     C
            //   \   /
            //     D

            const a = signal('a');
            const b = computed(() => a());
            const c = computed(() => a());

            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('a a');
            expect(spy).toHaveBeenCalledOnce();

            a.set('aa');
            expect(d()).toBe('aa aa');
            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should only update every signal once (diamond graph + tail)', async () => {
            //     A
            //   /   \
            //  B     C
            //   \   /
            //     D
            //     |
            //     E

            const a = signal('a');
            const b = computed(() => a());
            const c = computed(() => a());

            const d = computed(() => b() + ' ' + c());

            const spy = vi.fn(() => d());
            const e = computed(spy);

            expect(e()).toBe('a a');
            expect(spy).toHaveBeenCalledOnce();

            a.set('aa');
            expect(e()).toBe('aa aa');
            expect(spy).toHaveBeenCalledTimes(2);
        });

        it('should bail out if result is the same', () => {
            // A->B->C
            const a = signal('a');
            const b = computed(() => {
                a();
                return 'foo';
            });

            const spy = vi.fn(() => b());
            const c = computed(spy);

            expect(c()).toBe('foo');
            expect(spy).toHaveBeenCalledOnce();

            a.set('aa');
            expect(c()).toBe('foo');
            expect(spy).toHaveBeenCalledOnce();
        });

        it('should only update every signal once (jagged diamond graph + tails)', () => {
            //     A
            //   /   \
            //  B     C
            //  |     |
            //  |     D
            //   \   /
            //     E
            //   /   \
            //  F     G
            const a = signal('a');

            const b = computed(() => a());
            const c = computed(() => a());

            const d = computed(() => c());

            const eSpy = vi.fn(() => b() + ' ' + d());
            const e = computed(eSpy);

            const fSpy = vi.fn(() => e());
            const f = computed(fSpy);
            const gSpy = vi.fn(() => e());
            const g = computed(gSpy);

            expect(f()).toBe('a a');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('a a');
            expect(gSpy).toHaveBeenCalledTimes(1);

            eSpy.mockClear();
            fSpy.mockClear();
            gSpy.mockClear();

            a.set('b');

            expect(e()).toBe('b b');
            expect(eSpy).toHaveBeenCalledTimes(1);

            expect(f()).toBe('b b');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('b b');
            expect(gSpy).toHaveBeenCalledTimes(1);

            eSpy.mockClear();
            fSpy.mockClear();
            gSpy.mockClear();

            a.set('c');

            expect(e()).toBe('c c');
            expect(eSpy).toHaveBeenCalledTimes(1);

            expect(f()).toBe('c c');
            expect(fSpy).toHaveBeenCalledTimes(1);

            expect(g()).toBe('c c');
            expect(gSpy).toHaveBeenCalledTimes(1);
        });

        it('should only subscribe to signals listened to', () => {
            //    *A
            //   /   \
            // *B     C <- we don't listen to C
            const a = signal('a');

            const b = computed(() => a());
            const spy = vi.fn(() => a());
            computed(spy);

            expect(b()).toBe('a');
            expect(spy).not.toHaveBeenCalled();

            a.set('aa');
            expect(b()).toBe('aa');
            expect(spy).not.toHaveBeenCalled();
        });

        it('should only subscribe to signals listened to II', async () => {
            //    *A
            //   /   \
            // *B     D <- we don't listen to C
            //  |
            // *C
            const a = signal('a');
            const spyB = vi.fn(() => a());
            const b = computed(spyB);

            const spyC = vi.fn(() => b());
            const c = computed(spyC);

            const d = computed(() => a());

            let result = '';
            const unsub = effect(() => {
                result = c();
            });

            await flushAll();
            expect(result).toBe('a');
            expect(d()).toBe('a');

            spyB.mockClear();
            spyC.mockClear();
            unsub();

            a.set('aa');

            expect(spyB).not.toHaveBeenCalled();
            expect(spyC).not.toHaveBeenCalled();
            expect(d()).toBe('aa');
        });

        it('should ensure subs update even if one dep unmarks it', async () => {
            //     A
            //   /   \
            //  B     *C <- returns same value every time
            //   \   /
            //     D
            const a = signal('a');
            const b = computed(() => a());
            const c = computed(() => {
                a();
                return 'c';
            });
            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('a c');
            spy.mockClear();

            a.set('aa');
            d();
            expect(spy).toHaveReturnedWith('aa c');
        });

        it('should ensure subs update even if two deps unmark it', () => {
            //     A
            //   / | \
            //  B *C *D
            //   \ | /
            //     E
            const a = signal('a');
            const b = computed(() => a());
            const c = computed(() => {
                a();
                return 'c';
            });
            const d = computed(() => {
                a();
                return 'd';
            });
            const spy = vi.fn(() => b() + ' ' + c() + ' ' + d());
            const e = computed(spy);

            expect(e()).toBe('a c d');
            spy.mockClear();

            a.set('aa');
            e();
            expect(spy).toHaveReturnedWith('aa c d');
        });

        it('should support lazy branches', () => {
            const a = signal(0);
            const b = computed(() => a());
            const c = computed(() => (a() > 0 ? a() : b()));

            expect(c()).toBe(0);
            a.set(1);
            expect(c()).toBe(1);

            a.set(0);
            expect(c()).toBe(0);
        });

        it('should not update a sub if all deps unmark it', () => {
            //     A
            //   /   \
            // *B     *C
            //   \   /
            //     D
            const a = signal('a');
            const b = computed(() => {
                a();
                return 'b';
            });
            const c = computed(() => {
                a();
                return 'c';
            });
            const spy = vi.fn(() => b() + ' ' + c());
            const d = computed(spy);

            expect(d()).toBe('b c');
            spy.mockClear();

            a.set('aa');
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
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
    });
});