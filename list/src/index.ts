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
    *[Symbol.iterator]() {
        for (let current = this.n; current != this; current = current.n) {
            yield current as T & ListNode;
        }
    }
}

export function append<T extends AllowedNodeObject>(list: List<T>, data: T) {
    // link data (list node)
    data.n = list;
    data.p = list.p;
    // link list
    list.p = list.p.n = data as ListNode;
}

export function prepend<T extends AllowedNodeObject>(list: List<T>, data: T) {
    // link data (list node)
    data.p = list;
    data.n = list.n;
    // link list
    list.n = list.n.p = data as ListNode;
}

export function remove(element: ListNode) {
    element.p.n = element.n;
    element.n.p = element.p;
}

export function removeRange(begin: ListNode, end: ListNode) {
    begin.p.n = end.n;
    end.n.p = begin.p;
}

// TODO insertAfter insertRangeAfter insertBefore insertRangeBefore
