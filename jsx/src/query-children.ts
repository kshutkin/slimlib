import { scope, signal } from '@slimlib/store';

import type { Signal } from '@slimlib/store';

export type QueryChildrenRoot = Element | DocumentFragment;

export type QueryChildrenOptions = MutationObserverInit;

export type QueryChildrenSignal<T extends Element = Element> = Signal<readonly T[]> & {
    ref: (root: QueryChildrenRoot | null) => void;
};

const defaultOptions: MutationObserverInit = {
    attributes: true,
    childList: true,
    subtree: true,
};

const sameElements = <T extends Element>(a: readonly T[], b: readonly T[]): boolean => {
    const length = a.length;
    if (length !== b.length) return false;
    for (let i = 0; i < length; ++i) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const readMatches = <T extends Element>(root: QueryChildrenRoot, selector: string): readonly T[] =>
    Array.from(root.querySelectorAll<T>(selector));

const setMatches = <T extends Element>(matches: Signal<readonly T[]>, previous: readonly T[], next: readonly T[]): readonly T[] => {
    if (!sameElements(previous, next)) {
        matches.set(next);
        return next;
    }
    return previous;
};

export const queryChildren = <T extends Element = Element>(
    root: QueryChildrenRoot,
    selector: string,
    options: QueryChildrenOptions = defaultOptions
): Signal<readonly T[]> => {
    const matches = signal<readonly T[]>([]);
    let previous = setMatches(matches, [], readMatches<T>(root, selector));
    const observer = new MutationObserver(() => {
        previous = setMatches(matches, previous, readMatches<T>(root, selector));
    });
    observer.observe(root, options);
    scope(onDispose => {
        onDispose(() => observer.disconnect());
    });
    return matches;
};

export const queryChildrenRef = <T extends Element = Element>(
    selector: string,
    options: QueryChildrenOptions = defaultOptions
): QueryChildrenSignal<T> => {
    const matches = signal<readonly T[]>([]) as QueryChildrenSignal<T>;
    let root: QueryChildrenRoot | null = null;
    let previous: readonly T[] = [];
    let observer: MutationObserver | null = null;
    let disposed = false;

    const disconnect = (): void => {
        observer?.disconnect();
        observer = null;
    };

    const clear = (): void => {
        disconnect();
        root = null;
        previous = setMatches(matches, previous, []);
    };

    matches.ref = nextRoot => {
        if (disposed || nextRoot === root) return;
        clear();
        if (nextRoot !== null) {
            root = nextRoot;
            previous = setMatches(matches, previous, readMatches<T>(nextRoot, selector));
            observer = new MutationObserver(() => {
                previous = setMatches(matches, previous, readMatches<T>(nextRoot, selector));
            });
            observer.observe(nextRoot, options);
        }
    };

    scope(onDispose => {
        onDispose(() => {
            disposed = true;
            clear();
        });
    });

    return matches;
};
