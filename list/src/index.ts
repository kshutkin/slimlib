export type ListNode = {
    n: ListNode; // next node
    p: ListNode; // previous node
};

type AllowedNodeObject = object & Partial<ListNode>;

export class List<T extends AllowedNodeObject> implements ListNode {
    n: ListNode;
    p: ListNode;
    constructor() {
        this.n = this.p = this;
    }
    [Symbol.iterator]() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: ListNode = this;
        return {
            next: () => {
                current = current.n;
                return {
                    done: current === this,
                    value: current as T & ListNode
                };
            }
        };
    }
    // shorter but slower version commented
    // *[Symbol.iterator]() {
    //     for (let current = this.n; current != this; current = current.n) {
    //         yield current as T & ListNode;
    //     }
    // }
}

export function append<T extends AllowedNodeObject>(element: ListNode, data: T) {
    // link data (list node)
    data.n = element;
    data.p = element.p;
    // link list
    element.p = element.p.n = data as ListNode;
}

export function appendRange(element: ListNode, begin: ListNode, end: ListNode) {
    // link end
    end.n = element.n;
    element.n.p = end;
    // link begin
    element.n = begin;
    begin.p = element;
}

export function prepend<T extends AllowedNodeObject>(element: ListNode, data: T) {
    // link data (list node)
    data.p = element;
    data.n = element.n;
    // link list
    element.n = element.n.p = data as ListNode;
}

export function prependRange(element: ListNode, begin: ListNode, end: ListNode) {
    // link begin
    begin.p = element.p;
    element.p.n = begin;
    // link end
    element.p = end;
    end.n = element;
}

export function remove(element: ListNode) {
    element.p.n = element.n;
    element.n.p = element.p;
}

export function removeRange(begin: ListNode, end: ListNode) {
    begin.p.n = end.n;
    end.n.p = begin.p;
}
