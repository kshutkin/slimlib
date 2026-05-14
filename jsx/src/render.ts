import { scope as createScope, flushEffects } from '@slimlib/store';

import { createElement, setOnDispose } from './create-element';
import type { Child } from './types';

/**
 * Mount JSX into `container`. The first argument must be a function that produces
 * the JSX tree — this ensures reactive bindings are created inside the render scope
 * so they can be torn down on dispose. Returns a dispose function.
 *
 * Usage: `render(() => <App />, document.body)`
 */
export const render = (factory: () => Child, container: Element | DocumentFragment): (() => void) => {
    let inserted: Node[] = [];
    const s = createScope(onDispose => {
        const prev = setOnDispose(onDispose);
        try {
            const frag = createElement(factory, null) as DocumentFragment;
            flushEffects();
            inserted = Array.from(frag.childNodes);
            container.appendChild(frag);
        } finally {
            setOnDispose(prev);
        }
    });
    return () => {
        s();
        for (const n of inserted) {
            if (n.parentNode === container) container.removeChild(n);
        }
    };
};
