import { type Child, type ElementType, FRAGMENT, type Props } from './types';

// TODO: scaffold — implement element creation, web-components support, and
// reactive prop/child bindings backed by @slimlib/store signals.

export const createElement = <P extends Props>(_type: ElementType<P>, _props: P | null, ..._children: Child[]): Node => {
    throw new Error('@slimlib/jsx: createElement() is not implemented yet');
};

export { FRAGMENT as Fragment };
