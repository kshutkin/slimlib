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
            ctx(); // cleanup
        });

        it('creates a scope with callback', () => {
            const callback = vi.fn();
            const ctx = scope(callback);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(expect.any(Function));
            ctx(); // cleanup
        });

        it('sets activeScope during callback execution', () => {
            let capturedScope = null;
            const ctx = scope(() => {
                capturedScope = activeScope;
            });
            expect(capturedScope).toBe(ctx);
            expect(activeScope).toBeUndefined();
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
            /** @type {import('vitest').Mock[]} */
            const subscribers = [vi.fn(), vi.fn(), vi.fn()];
            const store = state({ count: 0 });

            const ctx = scope(() => {
                for (const sub of subscribers) {
                    effect(() => sub(store.count));
                }
            });

            await flushAll();
            for (const sub of subscribers) {
                expect(sub).toHaveBeenCalledTimes(1);
            }

            ctx();

            store.count = 1;
            await flushAll();
            for (const sub of subscribers) {
                expect(sub).toHaveBeenCalledTimes(1);
            }
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

            const s = scope();
            const extended = s(() => {
                effect(() => subscriber(store.count));
            });
            if (extended) extended(() => {});

            await flushAll();
            expect(subscriber).toHaveBeenCalledTimes(1);

            s();
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
            /** @type {number[]} */
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
            /** @type {string[]} */
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
            /** @type {ReturnType<typeof scope> | null} */
            let innerScope = null;

            const outer = scope(() => {
                innerScope = scope(() => {});
            });

            // When outer is disposed, inner should also be disposed
            // We test this by checking that inner throws after outer disposal
            outer();

            expect(() => innerScope?.(() => {})).toThrow('Scope is disposed');
        });

        it('parent dispose disposes children', async () => {
            const outerSub = vi.fn();
            const innerSub = vi.fn();
            const store = state({ count: 0 });

            const outer = scope(() => {
                effect(() => outerSub(store.count));
                scope(() => {
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
            const detachedInner = scope(undefined, undefined);

            const outer = scope(() => {
                // Create effect in the detached inner scope
                detachedInner(() => {
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
            detachedInner();
        });

        it('explicit parent overrides default', async () => {
            const innerSub = vi.fn();
            const store = state({ count: 0 });

            const customParent = scope();

            const outer = scope(() => {
                scope(() => {
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
            /** @type {string[]} */
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
            /** @type {((cleanup: () => void) => void) | null} */
            let capturedOnDispose = null;
            const ctx = scope(onDispose => {
                capturedOnDispose = onDispose;
            });

            ctx();

            expect(() => {
                if (capturedOnDispose) capturedOnDispose(() => {});
            }).toThrow('Scope is disposed');
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
            expect(activeScope).toBeUndefined();
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
            expect(activeScope).toBeUndefined();

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

            /** @type {() => void} */
            let dispose = () => {};
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
            expect(activeScope).toBeUndefined();

            let capturedScope = null;
            const ctx = scope(() => {
                capturedScope = activeScope;
            });

            expect(/** @type {any} */ (capturedScope)).toBe(ctx);
            expect(activeScope).toBeUndefined();
        });

        it('activeScope updates during nested scope callbacks', () => {
            /** @type {(ReturnType<typeof scope> | undefined)[]} */
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
            /** @type {[import('vitest').Mock, import('vitest').Mock, import('vitest').Mock]} */
            const subs = [vi.fn(), vi.fn(), vi.fn()];

            // Create scopes and extend them
            /** @type {any} */
            const ctx1 = scope();
            /** @type {any} */
            const ctx2 = scope();
            /** @type {any} */
            const ctx3 = scope();

            setActiveScope(ctx1);
            effect(() => {
                subs[0](store.count);
            });
            setActiveScope(ctx2);
            effect(() => {
                subs[1](store.count);
            });
            setActiveScope(ctx3);
            effect(() => {
                subs[2](store.count);
            });
            setActiveScope(undefined);

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

    describe('error handling during disposal', () => {
        it('continues disposing children even if one throws', () => {
            /** @type {string[]} */
            const order = [];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const outer = scope(() => {
                scope(onDispose => {
                    onDispose(() => {
                        order.push('child1');
                        throw new Error('child1 error');
                    });
                });
                scope(onDispose => {
                    onDispose(() => {
                        order.push('child2');
                    });
                });
                scope(onDispose => {
                    onDispose(() => {
                        order.push('child3');
                    });
                });
            });

            outer();
            expect(order).toEqual(['child1', 'child2', 'child3']);
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[0])[0]).message).toBe('child1 error');

            consoleError.mockRestore();
        });

        it('continues stopping effects even if one throws', async () => {
            /** @type {string[]} */
            const order = [];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const store = state({ count: 0 });

            const ctx = scope(() => {
                effect(() => {
                    store.count;
                    return () => {
                        order.push('effect1');
                        throw new Error('effect1 error');
                    };
                });
                effect(() => {
                    store.count;
                    return () => {
                        order.push('effect2');
                    };
                });
            });

            await flushAll();

            ctx();
            expect(order).toEqual(['effect1', 'effect2']);
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[0])[0]).message).toBe('effect1 error');

            consoleError.mockRestore();
        });

        it('continues running cleanups even if one throws', () => {
            /** @type {string[]} */
            const order = [];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const ctx = scope(onDispose => {
                onDispose(() => {
                    order.push('cleanup1');
                    throw new Error('cleanup1 error');
                });
                onDispose(() => {
                    order.push('cleanup2');
                });
                onDispose(() => {
                    order.push('cleanup3');
                });
            });

            ctx();
            expect(order).toEqual(['cleanup1', 'cleanup2', 'cleanup3']);
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[0])[0]).message).toBe('cleanup1 error');

            consoleError.mockRestore();
        });

        it('logs all errors to console', () => {
            /** @type {string[]} */
            const order = [];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            const ctx = scope(onDispose => {
                onDispose(() => {
                    order.push('cleanup1');
                    throw new Error('error1');
                });
                onDispose(() => {
                    order.push('cleanup2');
                    throw new Error('error2');
                });
                onDispose(() => {
                    order.push('cleanup3');
                });
            });

            ctx();
            expect(order).toEqual(['cleanup1', 'cleanup2', 'cleanup3']);
            expect(consoleError).toHaveBeenCalledTimes(2);
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[0])[0]).message).toBe('error1');
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[1])[0]).message).toBe('error2');

            consoleError.mockRestore();
        });

        it('logs errors from children, effects, and cleanups', async () => {
            /** @type {string[]} */
            const order = [];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const store = state({ count: 0 });

            const outer = scope(() => {
                scope(onDispose => {
                    onDispose(() => {
                        order.push('child');
                        throw new Error('child error');
                    });
                });

                effect(() => {
                    store.count;
                    return () => {
                        order.push('effect');
                        throw new Error('effect error');
                    };
                });
            });

            outer(onDispose => {
                onDispose(() => {
                    order.push('cleanup');
                    throw new Error('cleanup error');
                });
            });

            await flushAll();

            outer();
            expect(order).toEqual(['child', 'effect', 'cleanup']);
            expect(consoleError).toHaveBeenCalledTimes(3);
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[0])[0]).message).toBe('child error');
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[1])[0]).message).toBe('effect error');
            expect(/** @type {Error} */ (/** @type {unknown[]} */ (consoleError.mock.calls[2])[0]).message).toBe('cleanup error');

            consoleError.mockRestore();
        });

        it('removes from parent even after errors', () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const parent = scope();
            /** @type {() => void} */
            let childRef = () => {};
            parent(() => {
                childRef = scope(onDispose => {
                    onDispose(() => {
                        throw new Error('cleanup error');
                    });
                });
            });

            // Child should be registered with parent initially
            childRef();
            expect(consoleError).toHaveBeenCalledTimes(1);

            // Parent should still be able to dispose without issues
            // (child already removed itself)
            expect(() => parent()).not.toThrow();

            consoleError.mockRestore();
        });
    });
});
