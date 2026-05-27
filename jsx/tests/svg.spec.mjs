import { describe, expect, it } from 'vitest';

import { setScheduler } from '@slimlib/store';

import { createElement, html, svg } from '../src/index.ts';

setScheduler(fn => fn());

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

describe('svg() / html() factory wrappers', () => {
    it('creates <svg> and child <circle> in the SVG namespace', () => {
        const root = svg(() => createElement('svg', null, createElement('circle', { r: '10' })));
        expect(root.namespaceURI).toBe(SVG_NS);
        const circle = root.firstChild;
        expect(circle.namespaceURI).toBe(SVG_NS);
        expect(circle.getAttribute('r')).toBe('10');
    });

    it('creates plain HTML elements outside svg(...)', () => {
        const div = createElement('div', null);
        expect(div.namespaceURI).toBe(HTML_NS);
    });

    it('nested html() inside svg(...) restores the HTML namespace', () => {
        const root = svg(() =>
            createElement(
                'svg',
                null,
                createElement(
                    'foreignObject',
                    null,
                    html(() => createElement('div', null))
                )
            )
        );
        expect(root.namespaceURI).toBe(SVG_NS);
        const foreign = root.firstChild;
        expect(foreign.namespaceURI).toBe(SVG_NS);
        const div = foreign.firstChild;
        expect(div.namespaceURI).toBe(HTML_NS);
    });

    it('restores the previous namespace after svg() returns', () => {
        svg(() => createElement('svg', null));
        const after = createElement('div', null);
        expect(after.namespaceURI).toBe(HTML_NS);
    });
});
