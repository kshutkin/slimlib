import { append, List, ListNode, prepend, remove, removeRange } from '../src';

describe('list', () => {

    it('smoke', () => {
        expect(List).toBeDefined();
    });

    it('append / iterate', () => {
        const list = new List<{value: number}>();
        append(list, { value: 1 });
        append(list, { value: 2 });
        append(list, { value: 3 });
        append(list, { value: 4 });
        append(list, { value: 5 });
        append(list, { value: 6 });
        append(list, { value: 7 });
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('prepend / iterate', () => {
        const list = new List<{value: number}>();
        prepend(list, { value: 1 });
        prepend(list, { value: 2 });
        prepend(list, { value: 3 });
        prepend(list, { value: 4 });
        prepend(list, { value: 5 });
        prepend(list, { value: 6 });
        prepend(list, { value: 7 });
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([7, 6, 5, 4, 3, 2, 1]);
    });

    it('append / remove / iterate', () => {
        const list = new List<{value: number}>();
        let elem: Partial<ListNode> & {value: number};
        append(list, { value: 1 });
        append(list, { value: 2 });
        append(list, { value: 3 });
        append(list, (elem = { value: 4 }));
        append(list, { value: 5 });
        append(list, { value: 6 });
        append(list, { value: 7 });
        remove(elem as ListNode);
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([1, 2, 3, 5, 6, 7]);
    });

    it('append / removeRange / iterate', () => {
        const list = new List<{value: number}>();
        append(list, { value: 1 });
        append(list, { value: 2 });
        append(list, { value: 3 });
        append(list, { value: 4 });
        append(list, { value: 5 });
        append(list, { value: 6 });
        append(list, { value: 7 });
        removeRange(list.n.n, list.p.p);
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([1, 7]);
    });
});
