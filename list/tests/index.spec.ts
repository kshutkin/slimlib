import { describe, it, expect } from 'vitest';
import { append, appendRange, List, ListNode, prepend, prependRange, remove, removeRange } from '../src/index.js';

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

    it('append / appendRange / iterate', () => {
        const temp = new List<{value: number}>();
        append(temp, { value: 1 });
        append(temp, { value: 2 });
        append(temp, { value: 3 });
        append(temp, { value: 4 });
        append(temp, { value: 5 });
        append(temp, { value: 6 });
        append(temp, { value: 7 });
        const list = new List<{value: number}>();
        append(list, { value: 1 });
        append(list, { value: 2 });
        append(list, { value: 3 });
        append(list, { value: 4 });
        append(list, { value: 5 });
        append(list, { value: 6 });
        append(list, { value: 7 });
        appendRange(list.n, temp.n, temp.p);
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7]);
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

    it('append / prependRange / iterate', () => {
        const temp = new List<{value: number}>();
        append(temp, { value: 1 });
        append(temp, { value: 2 });
        append(temp, { value: 3 });
        append(temp, { value: 4 });
        append(temp, { value: 5 });
        append(temp, { value: 6 });
        append(temp, { value: 7 });
        const list = new List<{value: number}>();
        append(list, { value: 1 });
        append(list, { value: 2 });
        append(list, { value: 3 });
        append(list, { value: 4 });
        append(list, { value: 5 });
        append(list, { value: 6 });
        append(list, { value: 7 });
        prependRange(list.n, temp.n, temp.p);
        const result = Array.from(list).map(item => item.value);
        expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7]);
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
