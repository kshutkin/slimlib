import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { computed, effect, flushEffects, scope, setActiveScope, signal, state } from '../src/index.js';
import { childrenSymbol } from '../src/symbols.js';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve));
}

async function flushAll() {
    await Promise.resolve();
    flushEffects();
    await flushPromises();
}

describe('edge cases', () => {
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

    describe('makeLive with empty subs list', () => {
        it('should add link to empty subs list when computed becomes live', async () => {
            // This tests the case where makeLive adds a link to a dependency
            // that has no prior subscribers (dep.$_subs = linkNode path)
            
            const sig = signal(1);
            
            // Create a non-live computed that reads the signal
            const comp = computed(() => sig());
            
            // Read it once to establish the dependency (non-live path)
            expect(comp()).toBe(1);
            
            // Now create an effect that reads the computed
            // This makes the computed live, and the signal had no prior subs
            let effectValue = 0;
            effect(() => {
                effectValue = comp();
            });
            
            await flushAll();
            expect(effectValue).toBe(1);
            
            // Verify reactivity works (proves the link was properly added)
            sig.set(2);
            await flushAll();
            expect(effectValue).toBe(2);
        });

        it('should add first subscriber to empty subs list (makeLive path)', async () => {
            // This specifically tests line 274 in core.ts: dep.$_subs = linkNode
            // This happens when makeLive adds a link to a dependency that has
            // zero prior subscribers (empty subs list)
            
            const sig = signal(5);
            
            // Create a computed that reads the signal
            const comp = computed(() => sig() * 3);
            
            // Read the computed NON-LIVE first
            // This creates a link from comp to sig, but does NOT add to sig's subs
            // because comp is not live yet
            expect(comp()).toBe(15);
            
            // At this point, sig has no subscribers (subs list is empty)
            // Now create an effect that reads the computed
            // This will call makeLive(comp), which will add the link to sig's subs
            // Since sig's subs is empty, we hit the dep.$_subs = linkNode path
            let effectValue = 0;
            effect(() => {
                effectValue = comp();
            });
            
            await flushAll();
            expect(effectValue).toBe(15);
            
            // Verify the subscription is working (proves link was added)
            sig.set(10);
            await flushAll();
            expect(effectValue).toBe(30);
        });

        it('should add to non-empty subs list when multiple computeds share source', async () => {
            // This specifically tests line 272 in core.ts: prevSub.$_nextSub = linkNode
            // This happens when makeLive adds a link to a dependency that ALREADY
            // has subscribers (non-empty subs list)
            
            const sig = signal(1);
            
            // Create two computeds that both read the same signal
            const comp1 = computed(() => sig() * 2);
            const comp2 = computed(() => sig() * 3);
            
            // Read both non-live first to establish deps
            expect(comp1()).toBe(2);
            expect(comp2()).toBe(3);
            
            // Now make comp1 live via an effect
            // This adds comp1's link to sig's subs (sig's subs was empty)
            let eff1Value = 0;
            effect(() => {
                eff1Value = comp1();
            });
            
            await flushAll();
            expect(eff1Value).toBe(2);
            
            // Now make comp2 live via another effect
            // This adds comp2's link to sig's subs, which is NOT empty (has comp1's link)
            // This should hit the prevSub.$_nextSub = linkNode path
            let eff2Value = 0;
            effect(() => {
                eff2Value = comp2();
            });
            
            await flushAll();
            expect(eff2Value).toBe(3);
            
            // Verify both are reactive (proves both links were properly added)
            sig.set(10);
            await flushAll();
            expect(eff1Value).toBe(20);
            expect(eff2Value).toBe(30);
        });

        it('should handle chain of computeds becoming live with empty subs', async () => {
            // Chain: signal -> comp1 -> comp2 -> effect
            // When effect is created, comp2 becomes live, then comp1 becomes live
            // At each step, the dependency has no prior subs
            
            const sig = signal(10);
            
            const comp1 = computed(() => sig() * 2);
            const comp2 = computed(() => comp1() + 1);
            
            // Read them non-live first
            expect(comp2()).toBe(21);
            
            // Now make them live via an effect
            let effectValue = 0;
            effect(() => {
                effectValue = comp2();
            });
            
            await flushAll();
            expect(effectValue).toBe(21);
            
            // Verify the chain is reactive
            sig.set(5);
            await flushAll();
            expect(effectValue).toBe(11);
        });
    });

    describe('computed with no dependencies', () => {
        it('should handle computed that conditionally has no dependencies', async () => {
            // This tests the path where a computed previously had dependencies
            // but now has none (lines 472-473 in core.ts)
            // 
            // We use an external boolean (not a signal) for the condition
            // so that when condition is false, the computed truly reads NOTHING
            
            let condition = true;
            const value = signal(42);
            const trigger = signal(0); // Used to force recomputation
            
            let computeCount = 0;
            const comp = computed(() => {
                computeCount++;
                trigger(); // Always read trigger to allow forcing recompute
                if (condition) {
                    return value();
                }
                // When condition is false, we ONLY read trigger (1 dep instead of 2)
                return 0;
            });
            
            // Initial read with dependencies (trigger + value)
            expect(comp()).toBe(42);
            expect(computeCount).toBe(1);
            
            // Make it live via an effect
            let effectValue = 0;
            effect(() => {
                effectValue = comp();
            });
            
            await flushAll();
            expect(effectValue).toBe(42);
            // computeCount is still 1 because the cached value was reused
            expect(computeCount).toBe(1);
            
            // Now switch condition - next recompute will read fewer deps
            condition = false;
            trigger.set(1); // Force recomputation
            await flushAll();
            expect(effectValue).toBe(0);
            expect(computeCount).toBe(2);
            
            // Value changes should not trigger re-computation now
            value.set(100);
            await flushAll();
            // Effect should not rerun since computed no longer depends on value
            expect(effectValue).toBe(0);
            expect(computeCount).toBe(2);
        });

        it('should clear all deps when computed reads nothing on rerun', async () => {
            // This specifically tests the clearSources path where node.$_deps exists
            // but newTail is undefined (no dependencies tracked in current run)
            
            let shouldRead = true;
            const value = signal(10);
            
            let computeCount = 0;
            const comp = computed(() => {
                computeCount++;
                if (shouldRead) {
                    return value();
                }
                // Read absolutely nothing - return constant
                return -1;
            });
            
            // Initial read establishes dependency
            expect(comp()).toBe(10);
            expect(computeCount).toBe(1);
            
            // Now the computed has deps. Force a recompute with no reads
            shouldRead = false;
            value.set(20); // This triggers DIRTY flag
            
            // Reading the computed now should clear all deps
            expect(comp()).toBe(-1);
            expect(computeCount).toBe(2);
            
            // Further value changes should not trigger recomputation
            // since computed has no deps
            value.set(30);
            expect(comp()).toBe(-1);
            // Should still be 2 because no deps means no staleness detected
            expect(computeCount).toBe(2);
        });

        it('should handle effect that conditionally reads nothing', async () => {
            const condition = signal(true);
            const value = signal(1);
            
            let runCount = 0;
            let lastValue = 0;
            
            effect(() => {
                runCount++;
                if (condition()) {
                    lastValue = value();
                } else {
                    // Read nothing
                    lastValue = -1;
                }
            });
            
            await flushAll();
            expect(runCount).toBe(1);
            expect(lastValue).toBe(1);
            
            // Change value - should trigger
            value.set(2);
            await flushAll();
            expect(runCount).toBe(2);
            expect(lastValue).toBe(2);
            
            // Switch condition - effect reads nothing now
            condition.set(false);
            await flushAll();
            expect(runCount).toBe(3);
            expect(lastValue).toBe(-1);
            
            // Value changes should not trigger (effect has no deps except condition was read)
            // Actually condition was still read, so only value change is ignored
            const currentRunCount = runCount;
            value.set(100);
            await flushAll();
            expect(runCount).toBe(currentRunCount);
        });

        it('should handle computed that returns constant (no reactive reads)', () => {
            // A computed that never reads any reactive sources
            let computeCount = 0;
            const constComp = computed(() => {
                computeCount++;
                return 42; // No reactive reads
            });
            
            expect(constComp()).toBe(42);
            expect(computeCount).toBe(1);
            
            // Reading again should return cached value
            expect(constComp()).toBe(42);
            expect(computeCount).toBe(1);
        });
    });

    describe('scope disposal with throwing children', () => {
        it('should log error when child scope throws during disposal (child scope path)', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            try {
                const parent = scope();
                
                // Create a child scope
                // The child scope has an effect that throws during cleanup
                // When parent disposes, it calls child(), which disposes the effect,
                // which runs cleanup and throws
                scope(() => {
                    effect(() => {
                        return () => {
                            throw new Error('Child scope cleanup error');
                        };
                    });
                }, parent);
                
                await flushAll();
                
                // Dispose parent - this disposes child first, which throws in effect cleanup
                parent();
                
                // Should have logged the error
                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('should continue disposing other children after one throws', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            try {
                const parent = scope();
                
                const disposed = { child1: false, child2: false, child3: false };
                
                // First child - normal
                scope((onDispose) => {
                    onDispose(() => {
                        disposed.child1 = true;
                    });
                }, parent);
                
                // Second child - will throw
                scope((onDispose) => {
                    onDispose(() => {
                        disposed.child2 = true;
                        throw new Error('Child 2 error');
                    });
                }, parent);
                
                // Third child - should still be disposed
                scope((onDispose) => {
                    onDispose(() => {
                        disposed.child3 = true;
                    });
                }, parent);
                
                // Dispose parent
                parent();
                
                // All children should have been disposed despite the throw
                expect(disposed.child1).toBe(true);
                expect(disposed.child2).toBe(true);
                expect(disposed.child3).toBe(true);
                
                // Error should have been logged
                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('should handle nested scope throwing during child disposal', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            try {
                const grandparent = scope();
                
                const disposed = { parent: false, child: false };
                
                // Create parent scope
                const parent = scope((onDispose) => {
                    onDispose(() => {
                        disposed.parent = true;
                    });
                }, grandparent);
                
                // Create child of parent that throws
                scope((onDispose) => {
                    onDispose(() => {
                        disposed.child = true;
                        throw new Error('Nested child error');
                    });
                }, parent);
                
                // Dispose grandparent - should cascade
                grandparent();
                
                expect(disposed.parent).toBe(true);
                expect(disposed.child).toBe(true);
                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('should catch error when child in children array throws directly', () => {
            // This test directly injects a throwing function into the children array
            // to test the catch block in the children disposal loop (line 41 in scope.ts)
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            try {
                const parent = scope();
                
                // Inject a throwing "child" directly into the children array
                const children = parent[childrenSymbol];
                children.push(() => {
                    throw new Error('Direct child throw');
                });
                
                // Also add a normal child to verify disposal continues
                let normalChildDisposed = false;
                children.push(() => {
                    normalChildDisposed = true;
                });
                
                // Dispose parent
                parent();
                
                // The error should have been caught and logged
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
                
                // Normal child should still have been "disposed"
                expect(normalChildDisposed).toBe(true);
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });
    });

    describe('computed becoming non-live', () => {
        it('should properly cleanup when effect is disposed', async () => {
            const sig = signal(1);
            
            let computeCount = 0;
            const comp = computed(() => {
                computeCount++;
                return sig() * 2;
            });
            
            // Make computed live via effect
            let effectValue = 0;
            const dispose = effect(() => {
                effectValue = comp();
            });
            
            await flushAll();
            expect(effectValue).toBe(2);
            expect(computeCount).toBe(1);
            
            // Dispose effect - computed becomes non-live
            dispose();
            
            // Signal change should not trigger recomputation
            sig.set(5);
            await flushAll();
            expect(effectValue).toBe(2); // Unchanged
            
            // But reading computed should give correct value (via polling)
            expect(comp()).toBe(10);
            expect(computeCount).toBe(2);
        });

        it('should handle chain becoming non-live', async () => {
            const sig = signal(1);
            
            let comp1Count = 0;
            let comp2Count = 0;
            
            const comp1 = computed(() => {
                comp1Count++;
                return sig() * 2;
            });
            
            const comp2 = computed(() => {
                comp2Count++;
                return comp1() + 10;
            });
            
            // Make chain live
            let effectValue = 0;
            const dispose = effect(() => {
                effectValue = comp2();
            });
            
            await flushAll();
            expect(effectValue).toBe(12);
            expect(comp1Count).toBe(1);
            expect(comp2Count).toBe(1);
            
            // Dispose - chain becomes non-live
            dispose();
            
            sig.set(5);
            await flushAll();
            expect(effectValue).toBe(12); // Unchanged
            
            // Reading should poll and recompute
            expect(comp2()).toBe(20);
            expect(comp1Count).toBe(2);
            expect(comp2Count).toBe(2);
        });
    });

    describe('state method with no tracking', () => {
        it('should handle method calls outside of effects', async () => {
            const arr = state({ items: [] });
            
            // Call method outside of any reactive context
            arr.items.push(1);
            arr.items.push(2);
            
            expect(arr.items).toEqual([1, 2]);
            
            // Now track with effect
            let tracked = [];
            effect(() => {
                tracked = [...arr.items];
            });
            
            await flushAll();
            expect(tracked).toEqual([1, 2]);
            
            // Mutate
            arr.items.push(3);
            await flushAll();
            expect(tracked).toEqual([1, 2, 3]);
        });
    });
});