import type { Child } from './types';

// TODO: scaffold — implement reactive mount/unmount, attribute/property handling,
// event listeners, and custom-element-aware child reconciliation.

export const render = (_child: Child, _container: Element | DocumentFragment): (() => void) => {
    throw new Error('@slimlib/jsx: render() is not implemented yet');
};
