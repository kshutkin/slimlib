/**
 * @typedef {object} ListNode
 * @property {ListNode} n - next node
 * @property {ListNode} p - previous node
 */

/**
 * @typedef {object & Partial<ListNode>} AllowedNodeObject
 */

/**
 * @template {AllowedNodeObject} T
 * @implements {ListNode}
 */
export class List {
    /** @type {ListNode} */
    n;
    /** @type {ListNode} */
    p;

    constructor() {
        this.n = this.p = this;
    }

    [Symbol.iterator]() {
        /** @type {ListNode} */
        let current = this;
        return {
            next: () => {
                current = current.n;
                return {
                    done: current === this,
                    value: /** @type {T & ListNode} */ (current),
                };
            },
        };
    }
    // shorter but slower version commented
    // *[Symbol.iterator]() {
    //     for (let current = this.n; current != this; current = current.n) {
    //         yield current as T & ListNode;
    //     }
    // }
}

/**
 * @template {AllowedNodeObject} T
 * @param {ListNode} element
 * @param {T} data
 */
export const append = (element, data) => {
    // link data (list node)
    data.n = element;
    data.p = element.p;
    // link list
    element.p = element.p.n = /** @type {ListNode} */ (data);
};

/**
 * @param {ListNode} element
 * @param {ListNode} begin
 * @param {ListNode} end
 */
export const appendRange = (element, begin, end) => {
    // link end
    end.n = element.n;
    element.n.p = end;
    // link begin
    element.n = begin;
    begin.p = element;
};

/**
 * @template {AllowedNodeObject} T
 * @param {ListNode} element
 * @param {T} data
 */
export const prepend = (element, data) => {
    // link data (list node)
    data.p = element;
    data.n = element.n;
    // link list
    element.n = element.n.p = /** @type {ListNode} */ (data);
};

/**
 * @param {ListNode} element
 * @param {ListNode} begin
 * @param {ListNode} end
 */
export const prependRange = (element, begin, end) => {
    // link begin
    begin.p = element.p;
    element.p.n = begin;
    // link end
    element.p = end;
    end.n = element;
};

/**
 * @param {ListNode} element
 */
export const remove = element => {
    element.p.n = element.n;
    element.n.p = element.p;
};

/**
 * @param {ListNode} begin
 * @param {ListNode} end
 */
export const removeRange = (begin, end) => {
    begin.p.n = end.n;
    end.n.p = begin.p;
};
