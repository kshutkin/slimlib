import { skipScopeRemoval } from './symbols';
import type { EffectDisposer } from './internal-types';

export class DisposerNode {
    constructor(
        public readonly $_disposer: EffectDisposer,
        public $_next: DisposerNode = this,
        public $_previous: DisposerNode = this
    ) {}
}

export const registerDisposer = (head: DisposerNode, disposer: EffectDisposer): DisposerNode => {
    const previous = head.$_previous;
    const node = new DisposerNode(disposer, head, previous);
    previous.$_next = node;
    head.$_previous = node;
    return node;
};

export const unlinkDisposer = (node: DisposerNode | undefined, flag?: symbol): undefined => {
    if (node && flag !== skipScopeRemoval) {
        node.$_previous.$_next = node.$_next;
        node.$_next.$_previous = node.$_previous;
    }
};

export const drainDisposers = (head: DisposerNode): void => {
    // Read the previous link after cleanup, which can manually unlink a sibling.
    for (let node = head.$_previous; node !== head; node = node.$_previous) {
        try {
            node.$_disposer(skipScopeRemoval);
        } catch (e) {
            console.error(e);
        }
    }
    head.$_next = head.$_previous = head;
};
