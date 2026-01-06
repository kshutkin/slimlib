import { describe, expect, it, vi } from 'vitest';

import { activeScope, effect, flushEffects, scope, setActiveScope, state } from '../src/index.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('scope', () => {
    describe('basic functionality', () => {
        it('creates a scope without callback', () => {
            const ctx = scope();
            expect(ctx).toBeTypeOf('function');
        });

        it('creates a scope with callback', () => {
            const callback = vi.fn();
            const ctx = scope(callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(expect.any(Function));
        });

        it('sets activeScope during callback execution', () => {
            let capturedScope = null;
            const ctx = scope(() => {
                capturedScope = activeScope;
            });
            expect(capturedScope).toBe(ctx);
            expect(activeScope).toBeNull();
        });

        it('restores previous activeScope after callback', () => {
            const outer = scope();
            setActiveScope(outer);

            let innerCapturedScope = null;
            const inner = scope(() => {
                innerCapturedScope = activeScope;
            });

            expect(innerCapturedScope).toBe(inner);
            expect(activeScope).toBe(outer);
            setActiveScope(undefined);
        });
    });

    describe('effect tracking', () => {
        it('tracks effects created inside scope callback', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            const ctx = scope(() => {
                effect(() => {
                    subscriber(store.count);
                });
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            store.count = 1;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);

            // Dispose scope
            ctx();

            // Effect should no longer run
            store.count = 2;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
        });

        it('tracks effects when scope is extended', async () => {
            const subscriber1 = vi.fn();
            const subscriber2 = vi.fn();
            const store = state({ count: 0 });

            const ctx = scope(() => {
                effect(() => subscriber1(store.count));
            });

            ctx(() => {
                effect(() => subscriber2(store.count));
            });

            await flushAll();
            expect(subscriber1).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(1);

            // Dispose disposes both effects
            ctx();

            store.count = 1;
            await flushAll();
            expect(subscriber1).toHaveBeenCalledTimes(1);
            expect(subscriber2).toHaveBeenCalledTimes(1);
        });

        it('tracks effects when activeScope is set manually', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            const ctx = scope();
            setActiveScope(ctx);

            effect(() => {
                subscriber(store.count);
            });

            setActiveScope(undefined);

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            // Dispose scope
            ctx();

            store.count = 1;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });

        it('multiple effects in one scope are all disposed', async () => {
            const subscribers = [vi.fn(), vi.fn(), vi.fn()];
            const store = state({ count: 0 });

            const ctx = scope(() => {
                subscribers.forEach(sub => {
                    effect(() => sub(store.count));
                });
            });

            await flushAll();
            subscribers.forEach(sub => expect(sub).toHaveBeenCalledTimes(1));

            ctx();

            store.count = 1;
            await flushAll();
            subscribers.forEach(sub => expect(sub).toHaveBeenCalledTimes(1));
        });
    });

    describe('scope extension (chaining)', () => {
        it('ctx(callback) returns ctx for chaining', () => {
            const ctx = scope();
            const result = ctx(() => {});
            expect(result).toBe(ctx);
        });

        it('allows chained extensions', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            const ctx = scope()
                (() => effect(() => subscriber(store.count)))
                (() => {});

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            ctx();
        });
    });

    describe('onDispose callback', () => {
        it('runs cleanup on scope dispose', () => {
            const cleanup = vi.fn();

            const ctx = scope(onDispose => {
                onDispose(cleanup);
            });

            expect(cleanup).not.toHaveBeenCalled();
            ctx();
            expect(cleanup).toHaveBeenCalledTimes(1);
        });

        it('runs multiple cleanups in order', () => {
            const order = [];

            const ctx = scope(onDispose => {
                onDispose(() => order.push(1));
                onDispose(() => order.push(2));
            });

            ctx(onDispose => {
                onDispose(() => order.push(3));
            });

            ctx();
            expect(order).toEqual([1, 2, 3]);
        });

        it('effect cleanup runs before onDispose cleanup', async () => {
            const order = [];

            const ctx = scope(onDispose => {
                effect(() => {
                    return () => order.push('effect-cleanup');
                });
                onDispose(() => order.push('scope-cleanup'));
            });

            await flushAll();
            ctx();
            expect(order).toEqual(['effect-cleanup', 'scope-cleanup']);
        });
    });

    describe('hierarchical scopes', () => {
        it('inner scope defaults to outer scope as parent', () => {
            let innerScope = null;

            const outer = scope(() => {
                innerScope = scope(() => {});
            });

            // When outer is disposed, inner should also be disposed
            // We test this by checking that inner throws after outer disposal
            outer();

            expect(() => innerScope(() => {})).toThrow('Scope is disposed');
        });

        it('parent dispose disposes children', async () => {
            const outerSub = vi.fn();
            const innerSub = vi.fn();
            const store = state({ count: 0 });

            let inner = null;
            const outer = scope(() => {
                effect(() => outerSub(store.count));
                inner = scope(() => {
                    effect(() => innerSub(store.count));
                });
            });

            await flushAll();
            expect(outerSub).toHaveBeenCalledTimes(1);
            expect(innerSub).toHaveBeenCalledTimes(1);

            outer();

            store.count = 1;
            await flushAll();
            expect(outerSub).toHaveBeenCalledTimes(1);
            expect(innerSub).toHaveBeenCalledTimes(1);
        });

        it('explicit undefined parent creates detached scope', async () => {
            const innerSub = vi.fn();
            const store = state({ count: 0 });

            // Create inner scope with explicit undefined parent (detached)
            // The inner scope has no parent, and we set it as activeScope for the effect
            const inner = scope(undefined, undefined);

            const outer = scope(() => {
                // Create effect in the detached inner scope
                inner(() => {
                    effect(() => innerSub(store.count));
                });
            });

            await flushAll();
            expect(innerSub).toHaveBeenCalledTimes(1);

            outer();

            // Inner should still work because it's detached
            store.count = 1;
            await flushAll();
            expect(innerSub).toHaveBeenCalledTimes(2);

            // Clean up
            inner();
        });

        it('explicit parent overrides default', async () => {
            const innerSub = vi.fn();
            const store = state({ count: 0 });

            const customParent = scope();

            let inner = null;
            const outer = scope(() => {
                inner = scope(() => {
                    effect(() => innerSub(store.count));
                }, customParent);
            });

            await flushAll();

            // Disposing outer should NOT dispose inner (wrong parent)
            outer();

            store.count = 1;
            await flushAll();
            expect(innerSub).toHaveBeenCalledTimes(2);

            // Disposing customParent SHOULD dispose inner
            customParent();

            store.count = 2;
            await flushAll();
            expect(innerSub).toHaveBeenCalledTimes(2);
        });

        it('deeply nested scopes dispose in correct order', () => {
            const order = [];

            const level1 = scope(onDispose => {
                onDispose(() => order.push('level1'));
                scope(onDispose => {
                    onDispose(() => order.push('level2'));
                    scope(onDispose => {
                        onDispose(() => order.push('level3'));
                    });
                });
            });

            level1();
            // Children dispose before parents
            expect(order).toEqual(['level3', 'level2', 'level1']);
        });
    });

    describe('disposed scope behavior', () => {
        it('throws when extending disposed scope', () => {
            const ctx = scope();
            ctx();

            expect(() => ctx(() => {})).toThrow('Scope is disposed');
        });

        it('throws when disposing already disposed scope', () => {
            const ctx = scope();
            ctx();

            expect(() => ctx()).toThrow('Scope is disposed');
        });

        it('throws when registering cleanup on disposed scope', () => {
            let capturedOnDispose = null;
            const ctx = scope(onDispose => {
                capturedOnDispose = onDispose;
            });

            ctx();

            expect(() => capturedOnDispose(() => {})).toThrow('Scope is disposed');
        });
    });

    describe('setActiveScope', () => {
        it('sets activeScope', () => {
            const ctx = scope();
            setActiveScope(ctx);
            expect(activeScope).toBe(ctx);
            setActiveScope(undefined);
        });

        it('clears activeScope with undefined', () => {
            const ctx = scope();
            setActiveScope(ctx);
            setActiveScope(undefined);
            expect(activeScope).toBeNull();
        });

        it('effects use activeScope when not in scope callback', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            const ctx = scope();
            setActiveScope(ctx);

            effect(() => subscriber(store.count));

            setActiveScope(undefined);

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            ctx();

            store.count = 1;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);
        });
    });

    describe('effects without scope', () => {
        it('effects work without scope when holding dispose reference', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            // Ensure no active scope
            expect(activeScope).toBeNull();

            // Effect works without scope - just hold the dispose function
            const dispose = effect(() => subscriber(store.count));

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            store.count = 1;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);

            dispose();

            store.count = 2;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
        });
    });

    describe('dispose function', () => {
        it('dispose function still works for scoped effects', async () => {
            const subscriber = vi.fn();
            const store = state({ count: 0 });

            let dispose = null;
            const ctx = scope(() => {
                dispose = effect(() => subscriber(store.count));
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            // Manual dispose should work
            dispose();

            store.count = 1;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            // Scope dispose is still safe (effect already disposed)
            ctx();
        });
    });

    describe('activeScope live binding', () => {
        it('activeScope is readable', () => {
            expect(activeScope).toBeNull();

            let capturedScope = null;
            const ctx = scope(() => {
                capturedScope = activeScope;
            });

            expect(capturedScope).toBe(ctx);
            expect(activeScope).toBeNull();
        });

        it('activeScope updates during nested scope callbacks', () => {
            const scopes = [];

            const outer = scope(() => {
                scopes.push(activeScope);
                scope(() => {
                    scopes.push(activeScope);
                });
                scopes.push(activeScope);
            });

            expect(scopes[0]).toBe(outer);
            expect(scopes[1]).not.toBe(outer);
            expect(scopes[2]).toBe(outer);
        });
    });

    describe('complex scenarios', () => {
        it('scope with computed and effect', async () => {
            const store = state({ x: 1, y: 2 });
            const subscriber = vi.fn();

            const { computed } = await import('../src/index.js');

            const ctx = scope(() => {
                const sum = computed(() => store.x + store.y);
                effect(() => subscriber(sum()));
            });

            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(3);

            store.x = 5;
            await flushAll();
            expect(subscriber).toHaveBeenCalledWith(7);

            ctx();

            store.y = 10;
            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(2);
        });

        it('rapidly creating and disposing scopes', async () => {
            const store = state({ value: 0 });

            for (let i = 0; i < 100; i++) {
                const subscriber = vi.fn();
                const ctx = scope(() => {
                    effect(() => subscriber(store.value));
                });
                await flushAll();
                expect(subscriber).toHaveBeenCalledTimes(1);
                ctx();
            }

            // Should not leak memory or have lingering effects
            store.value = 1;
            await flushAll();
        });

        it('interleaved scope creation and disposal', async () => {
            const store = state({ count: 0 });
            const subs = [vi.fn(), vi.fn(), vi.fn()];

            const ctx1 = scope(() => effect(() => subs[0](store.count)));
            const ctx2 = scope(() => effect(() => subs[1](store.count)));
            const ctx3 = scope(() => effect(() => subs[2](store.count)));

            await flushAll();

            ctx2(); // Dispose middle one

            store.count = 1;
            await flushAll();

            expect(subs[0]).toHaveBeenCalledTimes(2);
            expect(subs[1]).toHaveBeenCalledTimes(1); // Disposed
            expect(subs[2]).toHaveBeenCalledTimes(2);

            ctx1();
            ctx3();
        });
    });
});
