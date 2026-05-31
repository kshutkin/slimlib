// @ts-nocheck
/**
 * Minimal hand-rolled DOM for low-variance benchmarks of jsx/src/core.js.
 *
 * Goals:
 *   - Honest parent/child linked list (parentNode, firstChild, lastChild,
 *     nextSibling, previousSibling, appendChild/insertBefore/removeChild).
 *   - Constructor identity so `instanceof Node` in core.js works.
 *   - Empty stubs for setAttribute/removeAttribute/event listeners (we don't
 *     measure that work; core.js only does dispatch).
 *   - A few IDL setters on FakeHTMLElement.prototype so getPropertySetter
 *     exercises both the positive (`desc.set !== undefined`) and negative
 *     cache branches like the real DOM does.
 *
 * Install BEFORE importing core.js: this module sets globalThis.document,
 * globalThis.Node etc. as a side effect on import.
 */

class FakeNode {
    constructor() {
        this.parentNode = null;
        this.firstChild = null;
        this.lastChild = null;
        this.nextSibling = null;
        this.previousSibling = null;
    }

    appendChild(node) {
        // Hoist out of current parent (mirrors real DOM).
        if (node.parentNode !== null) node.parentNode.removeChild(node);
        // Fragments: append each child individually, like the real DOM.
        if (node instanceof FakeFragment) {
            let c = node.firstChild;
            while (c !== null) {
                const next = c.nextSibling;
                this.appendChild(c);
                c = next;
            }
            node.firstChild = null;
            node.lastChild = null;
            return node;
        }
        node.parentNode = this;
        node.previousSibling = this.lastChild;
        node.nextSibling = null;
        if (this.lastChild !== null) this.lastChild.nextSibling = node;
        else this.firstChild = node;
        this.lastChild = node;
        return node;
    }

    insertBefore(node, anchor) {
        if (anchor === null) return this.appendChild(node);
        if (node.parentNode !== null) node.parentNode.removeChild(node);
        if (node instanceof FakeFragment) {
            let c = node.firstChild;
            while (c !== null) {
                const next = c.nextSibling;
                this.insertBefore(c, anchor);
                c = next;
            }
            node.firstChild = null;
            node.lastChild = null;
            return node;
        }
        node.parentNode = this;
        node.nextSibling = anchor;
        node.previousSibling = anchor.previousSibling;
        if (anchor.previousSibling !== null) anchor.previousSibling.nextSibling = node;
        else this.firstChild = node;
        anchor.previousSibling = node;
        return node;
    }

    removeChild(node) {
        if (node.previousSibling !== null) node.previousSibling.nextSibling = node.nextSibling;
        else this.firstChild = node.nextSibling;
        if (node.nextSibling !== null) node.nextSibling.previousSibling = node.previousSibling;
        else this.lastChild = node.previousSibling;
        node.parentNode = null;
        node.previousSibling = null;
        node.nextSibling = null;
        return node;
    }
}

class FakeElement extends FakeNode {
    constructor(tagName) {
        super();
        this.tagName = tagName;
        // Stored attributes — accessor not used by core.js; kept for completeness.
        this._attrs = null;
    }

    setAttribute(_k, _v) {}
    removeAttribute(_k) {}
    addEventListener(_t, _f) {}
    removeEventListener(_t, _f) {}
}

class FakeHTMLElement extends FakeElement {}

// IDL setters on the prototype. core.js's getPropertySetter walks the chain
// looking for `Object.getOwnPropertyDescriptor(proto, key)` with a `.set` —
// these populate the positive cache path for common props. Anything else
// (id, data-foo, custom attrs) walks to the top and lands in the negative
// cache, which is what we want.
const defineIdlSetter = key => {
    Object.defineProperty(FakeHTMLElement.prototype, key, {
        configurable: true,
        get() {
            return this._props !== undefined ? this._props[key] : undefined;
        },
        set(v) {
            if (this._props === undefined) this._props = {};
            this._props[key] = v;
        },
    });
};
defineIdlSetter('className');
defineIdlSetter('disabled');
defineIdlSetter('value');
defineIdlSetter('id');
defineIdlSetter('title');
defineIdlSetter('type');

class FakeText extends FakeNode {
    constructor(data) {
        super();
        this.data = data;
        this.nodeType = 3;
    }
}

class FakeComment extends FakeNode {
    constructor(data) {
        super();
        this.data = data;
        this.nodeType = 8;
    }
}

class FakeFragment extends FakeNode {
    constructor() {
        super();
        this.nodeType = 11;
    }
}

const fakeDocument = {
    createElement(tag) {
        return new FakeHTMLElement(tag.toUpperCase());
    },
    createTextNode(text) {
        return new FakeText(String(text));
    },
    createComment(text) {
        return new FakeComment(String(text));
    },
    createDocumentFragment() {
        return new FakeFragment();
    },
};
fakeDocument.body = new FakeHTMLElement('BODY');

globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.Text = FakeText;
globalThis.Comment = FakeComment;
globalThis.DocumentFragment = FakeFragment;
globalThis.document = fakeDocument;

export { FakeNode, FakeElement, FakeHTMLElement, FakeText, FakeComment, FakeFragment, fakeDocument };
