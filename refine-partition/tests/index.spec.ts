import { describe, it, expect } from 'vitest';
import refiner from '../src/index.js';

describe('refine', () => {

    it('smoke', () => {
        expect(refiner).toBeDefined();
    });

    it('refine empty', () => {
        expect(runRefine([])).toEqual([]);
    });

    it('refine single set', () => {
        expect(runRefine([['test']])).toEqual([['test']]);
    });

    it('refine already refined', () => {
        expect(runRefine([['a'], ['b']])).toEqual([['a'], ['b']]);
    });

    it('refine sets overlapping by one element', () => {
        expect(runRefine([['a', 'c'], ['b', 'c']])).toEqual([['a'], ['c'], ['b']]);
    });

    it('refine long sets overlapping by one element', () => {
        expect(runRefine([['a', 'c', 'd', 'e'], ['b', 'c', 'f', 'g']])).toEqual([['a', 'd', 'e'], ['c'], ['b', 'f', 'g']]);
    });

    it('refine long sets overlapping by two elements', () => {
        expect(runRefine([['a', 'c', 'd', 'e'], ['b', 'c', 'd', 'g']])).toEqual([['a', 'e'], ['c', 'd'], ['b', 'g']]);
    });

    it('refine long sets overlapping by two elements (first with full overlap)', () => {
        expect(runRefine([['a', 'c'], ['a', 'c', 'd', 'g']])).toEqual([['a', 'c'], ['d', 'g']]);
    });

    it('refine long sets overlapping by two elements (second with full overlap)', () => {
        expect(runRefine([['a', 'c', 'd', 'g'], ['a', 'c']])).toEqual([['d', 'g'], ['a', 'c']]);
    });
});

function runRefine(input: string[][]) {
    const instance = refiner<string>();
    for (const element of input) {
        instance(element);
    }
    return toPojo(instance());
}

function toPojo(input: Iterable<Iterable<string>>) {
    const result: string[][] = [];
    for (const set of input) {
        result.push([...set]);
    }
    return result;
}