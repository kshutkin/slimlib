import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computed, configure, effect, scope, setActiveScope, signal, state } from '../src/index.js';

describe('configure', () => {
    /** @type {import('vitest').MockInstance<(message?: any, ...optionalParams: any[]) => void>} */
    let consoleWarnSpy;
    /** @type {ReturnType<typeof scope>} */
    let testScope;

    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Reset configuration before each test
        configure({ warnOnWriteInComputed: false });
        testScope = scope();
        setActiveScope(testScope);
    });

    afterEach(() => {
        testScope();
        setActiveScope(undefined);
        consoleWarnSpy.mockRestore();
        // Reset configuration after each test
        configure({ warnOnWriteInComputed: false });
    });

    describe('warnOnWriteInComputed', () => {
        it('should not warn by default when writing to signal inside computed', () => {
            const counter = signal(0);
            const other = signal(0);

            const comp = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn when enabled and writing to signal inside computed', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const other = signal(0);

            const comp = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to signal inside a computed'));
        });

        it('should warn when enabled and writing to state inside computed', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const obj = state({ value: 0 });

            const comp = computed(() => {
                obj.value = counter() + 1;
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should not warn when writing inside an effect', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const other = signal(0);

            const dispose = effect(() => {
                other.set(counter() + 1);
            });

            expect(consoleWarnSpy).not.toHaveBeenCalled();

            dispose();
        });

        it('should not warn when writing outside of computed/effect', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            counter.set(1);

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn on state property deletion inside computed', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            /** @type {{ value: number, toDelete?: number }} */
            const obj = state({ value: 0, toDelete: 1 });

            const comp = computed(() => {
                delete obj.toDelete;
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should warn on Object.defineProperty inside computed', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const obj = state({ value: 0 });

            const comp = computed(() => {
                Object.defineProperty(obj, 'newProp', { value: 42, writable: true, configurable: true, enumerable: true });
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Writing to state inside a computed'));
        });

        it('should be able to disable warnings after enabling them', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const other = signal(0);

            const comp1 = computed(() => {
                other.set(counter() + 1);
                return counter();
            });

            comp1();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

            // Disable warnings
            configure({ warnOnWriteInComputed: false });
            consoleWarnSpy.mockClear();

            const comp2 = computed(() => {
                other.set(counter() + 2);
                return counter();
            });

            comp2();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('should warn multiple times for multiple writes inside same computed', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const other1 = signal(0);
            const other2 = signal(0);

            const comp = computed(() => {
                other1.set(counter() + 1);
                other2.set(counter() + 2);
                return counter();
            });

            comp();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
        });

        it('should warn for nested computed writes', () => {
            configure({ warnOnWriteInComputed: true });

            const counter = signal(0);
            const other = signal(0);

            const inner = computed(() => {
                other.set(counter() + 1);
                return counter() * 2;
            });

            const outer = computed(() => {
                return inner() + 1;
            });

            outer();

            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        });
    });
});
