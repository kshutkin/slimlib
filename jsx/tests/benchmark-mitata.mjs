//@ts-nocheck

/**
 * Multi-framework DOM rendering benchmark (mitata edition).
 *
 * Compares mini DOM renderers / reactive primitives that target similar
 * niches as @slimlib/jsx:
 *   - uhtml             — tagged-template literal renderer
 *   - nano-jsx          — tiny JSX renderer (driven here via h() to avoid a
 *                         JSX transform; this file stays .mjs)
 *   - @mastrojs/reactive — pre-rendered HTML + signals + ReactiveElement
 *   - @slimlib/jsx      — placeholder until createElement/render are implemented
 *
 * Scenarios (skipped automatically if a library can't express them cleanly):
 *   1. create-1000          — render 1000 <div>item N</div> into a fresh container
 *   2. update-1000          — pre-render 1000 items, then patch every text node
 *   3. custom-element-mount — define a small custom element once, mount 100 of it
 *
 * Run with: pnpm bench:browser
 */

const { bench, group, run, summary } = await import('mitata');

// Scheduler probe: intercepts queueMicrotask / rAF / setTimeout(0) so we can
// drain each lib's deferred work uniformly inside the timed body. Records
// per-(scenario, lib) call counts as a fairness fingerprint.
const probe = await import('./scheduler-probe.mjs');
const fingerprint = Object.create(null);

// Load adapters lazily so a single failed import doesn't kill the whole bench.
async function safeImport(name, loader) {
    try {
        return await loader();
    } catch (err) {
        console.warn(`[bench] adapter "${name}" disabled: ${err.message}`);
        return null;
    }
}

const uhtml = await safeImport('uhtml', () => import('uhtml'));
const lighter = await safeImport('lighterhtml', () => import('lighterhtml'));
const nano = await safeImport('nano-jsx', () => import('nano-jsx'));
const mastro = await safeImport('@mastrojs/reactive', () => import('@mastrojs/reactive'));
const lit = await safeImport('lit-html', () => import('lit-html'));
const voby = await safeImport('voby', () => import('voby'));
const vanMod = await safeImport('vanjs-core', () => import('vanjs-core'));
const solidWeb = await safeImport('solid-js/web', () => import('solid-js/web'));
const solidH = await safeImport('solid-js/h', () => import('solid-js/h'));
const solid = await safeImport('solid-js', () => import('solid-js'));
const preact = await safeImport('preact', () => import('preact'));
const mithril = await safeImport('mithril', () => import('mithril'));
const snabbdom = await safeImport('snabbdom', () => import('snabbdom'));
const litRepeat = await safeImport('lit-html/directives/repeat', () => import('lit-html/directives/repeat.js'));
const slimlibJsx = await safeImport('@slimlib/jsx', () => import('../src/index.ts'));
const slimlibForEach = await safeImport('@slimlib/jsx/for-each', () => import('../src/for-each.ts'));
const slimlibStore = await safeImport('@slimlib/store', () => import('@slimlib/store'));

// @slimlib/jsx does not call flushEffects() internally — the library is
// scheduler-agnostic and leaves commit timing to @slimlib/store's scheduler
// (default: queueMicrotask). In a synchronous benchmark we must drain effects
// manually. `drainSlimlib` is `let` so the sync-scheduler wrapper can swap it
// for a no-op while it owns the scheduler; the default adapter always sees
// the real drain function.
let drainSlimlib = slimlibStore?.flushEffects ? () => slimlibStore.flushEffects() : () => {};
const realDrainSlimlib = drainSlimlib;
const noopDrainSlimlib = () => {};

const reactMod = await safeImport('react', () => import('react'));
const reactDomClient = await safeImport('react-dom/client', () => import('react-dom/client'));
const reactDom = await safeImport('react-dom', () => import('react-dom'));
const vueMod = await safeImport('vue', () => import('vue'));
const svelteMod = await safeImport('svelte', () => import('svelte'));
const svelteListMod = await safeImport('svelte:List', () => import('./svelte-adapter/List.svelte'));
const svelteKeyedMod = await safeImport('svelte:KeyedList', () => import('./svelte-adapter/KeyedList.svelte'));
const svelteDeepTreeMod = await safeImport('svelte:DeepTreeApp', () => import('./svelte-adapter/DeepTreeApp.svelte'));

// ----- adapters -------------------------------------------------------------

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function resetContainer(el) {
    el.textContent = '';
}

const N_ITEMS = 1000;
const N_ELEMENTS = 100;

// deep-tree scenario knobs: depth=6, breadth=4 → 4^6 = 4096 leaf spans
// nested inside ~5461 total elements. Big enough that per-level overhead
// shows, small enough to keep iterations fast.
const DEEP_DEPTH = 6;
const DEEP_BREADTH = 4;
const DEEP_LEAVES = DEEP_BREADTH ** DEEP_DEPTH;

// uhtml --------------------------------------------------------------------
const uhtmlAdapter = uhtml && {
    name: 'uhtml',
    create1000: {
        setup() {
            return { c: makeContainer() };
        },
        run(state) {
            resetContainer(state.c);
            const items = [];
            for (let i = 0; i < N_ITEMS; i++) items.push(uhtml.html`<div>item ${i}</div>`);
            uhtml.render(state.c, uhtml.html`${items}`);
        },
    },
    update1000: {
        setup() {
            const c = makeContainer();
            const state = { c, version: 0 };
            renderList(state);
            return state;
        },
        run(state) {
            state.version++;
            renderList(state);
        },
    },
    customElement: (() => {
        // Define exactly once per process.
        const tag = 'uhtml-counter';
        if (!customElements.get(tag)) {
            class UhtmlCounter extends HTMLElement {
                connectedCallback() {
                    uhtml.render(this, uhtml.html`<span>count: ${0}</span>`);
                }
            }
            customElements.define(tag, UhtmlCounter);
        }
        return {
            setup() {
                return { c: makeContainer() };
            },
            run(state) {
                resetContainer(state.c);
                for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
            },
        };
    })(),
    deepTree: {
        setup() {
            return { c: makeContainer() };
        },
        run(state) {
            resetContainer(state.c);
            uhtml.render(state.c, uhtmlDeepNode(DEEP_DEPTH, '0'));
        },
    },
    deepTreeUpdate: {
        // Strategy A: top-level re-render. Toggle the root label between 'A'
        // and 'B'; each leaf's text becomes 'A.0.0.0...' / 'B.0.0.0...'.
        // uhtml diffs from root to leaves and updates 4096 text holes.
        setup() {
            const c = makeContainer();
            const s = { c, label: 'A' };
            uhtml.render(c, uhtmlDeepNode(DEEP_DEPTH, s.label));
            return s;
        },
        run(state) {
            state.label = state.label === 'A' ? 'B' : 'A';
            uhtml.render(state.c, uhtmlDeepNode(DEEP_DEPTH, state.label));
        },
    },
};
function uhtmlDeepNode(depth, label) {
    if (depth === 0) return uhtml.html`<span>${label}</span>`;
    const children = new Array(DEEP_BREADTH);
    for (let i = 0; i < DEEP_BREADTH; i++) children[i] = uhtmlDeepNode(depth - 1, label + '.' + i);
    return uhtml.html`<div>${children}</div>`;
}
function renderList(state) {
    const v = state.version;
    const items = [];
    for (let i = 0; i < N_ITEMS; i++) items.push(uhtml.html`<div>item ${i}-${v}</div>`);
    uhtml.render(state.c, uhtml.html`${items}`);
}

// lighterhtml --------------------------------------------------------------
const lighterAdapter =
    lighter &&
    (() => {
        const html = lighter.html;
        const render = lighter.render;
        if (typeof html !== 'function' || typeof render !== 'function' || typeof html.for !== 'function') {
            console.warn('[bench] lighterhtml adapter disabled: missing html/render/html.for exports');
            return null;
        }
        const tag = 'x-counter-lighterhtml';
        if (!customElements.get(tag)) {
            try {
                class LighterCounter extends HTMLElement {
                    connectedCallback() {
                        render(this, () => html`<div>lighterhtml</div>`);
                    }
                }
                customElements.define(tag, LighterCounter);
            } catch (err) {
                console.warn(`[bench] lighterhtml define failed: ${err.message}`);
            }
        }
        function renderLighter(state) {
            const v = state.v;
            render(state.c, () => {
                const items = new Array(N_ITEMS);
                for (let i = 0; i < N_ITEMS; i++) items[i] = html`<div>item ${i}-${v}</div>`;
                return html`${items}`;
            });
        }
        function deepNode(depth, label) {
            if (depth === 0) return html`<span>${label}</span>`;
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) children[i] = deepNode(depth - 1, label + '.' + i);
            return html`<div>${children}</div>`;
        }
        return {
            name: 'lighterhtml',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    render(state.c, () => {
                        const items = new Array(N_ITEMS);
                        for (let i = 0; i < N_ITEMS; i++) items[i] = html`<div>item ${i}</div>`;
                        return html`${items}`;
                    });
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const state = { c, v: 0 };
                    renderLighter(state);
                    return state;
                },
                run(state) {
                    state.v++;
                    renderLighter(state);
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    render(state.c, () => deepNode(DEEP_DEPTH, '0'));
                },
            },
            deepTreeUpdate: {
                // Strategy A: top-level re-render with new root label.
                setup() {
                    const c = makeContainer();
                    const s = { c, label: 'A' };
                    render(c, () => deepNode(DEEP_DEPTH, s.label));
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    render(state.c, () => deepNode(DEEP_DEPTH, state.label));
                },
            },
        };
    })();

// nano-jsx -----------------------------------------------------------------
const nanoAdapter =
    nano &&
    (() => {
        const Nano = nano.default ?? nano;
        const h = nano.h ?? Nano.h;
        const render = Nano.render ?? nano.render;
        if (typeof h !== 'function' || typeof render !== 'function') {
            console.warn('[bench] nano-jsx adapter disabled: missing h/render exports');
            return null;
        }
        const tag = 'nano-counter';
        if (!customElements.get(tag)) {
            class NanoCounter extends HTMLElement {
                connectedCallback() {
                    render(h('span', null, 'count: 0'), this);
                }
            }
            customElements.define(tag, NanoCounter);
        }
        function NanoNode(props) {
            if (props.depth === 0) return h('span', null, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(NanoNode, { key: i, depth: props.depth - 1, label: props.label + '.' + i });
            }
            return h('div', null, children);
        }
        return {
            name: 'nano-jsx',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', null, `item ${i}`);
                    render(h('div', null, children), state.c);
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const state = { c, v: 0 };
                    renderNano(state);
                    return state;
                },
                run(state) {
                    state.v++;
                    renderNano(state);
                },
            },
            customElement: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                },
            },
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    render(h(NanoNode, { depth: DEEP_DEPTH, label: '0' }), state.c);
                },
            },
            deepTreeUpdate: {
                // Strategy A: re-render with a new root label prop; nano walks the
                // recursion and patches every leaf's text.
                setup() {
                    const c = makeContainer();
                    const s = { c, label: 'A' };
                    render(h(NanoNode, { depth: DEEP_DEPTH, label: s.label }), c);
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    render(h(NanoNode, { depth: DEEP_DEPTH, label: state.label }), state.c);
                },
            },
        };

        function renderNano(state) {
            const children = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', null, `item ${i}-${state.v}`);
            render(h('div', null, children), state.c);
        }
    })();

// @mastrojs/reactive -------------------------------------------------------
// Reactive Mastro is HTML-first and signal-driven; it does not expose a
// general "render a list of N divs" API. We only register the custom-element
// scenario for it, and explicitly skip the others.
const mastroAdapter =
    mastro &&
    (() => {
        const ReactiveElement = mastro.ReactiveElement;
        const signal = mastro.signal;
        if (!ReactiveElement || !signal) {
            console.warn('[bench] @mastrojs/reactive adapter disabled: missing ReactiveElement/signal');
            return null;
        }
        const tag = 'mastro-counter';
        if (!customElements.get(tag)) {
            class MastroCounter extends ReactiveElement {
                count = signal(0);
            }
            try {
                customElements.define(tag, MastroCounter);
            } catch (err) {
                console.warn(`[bench] @mastrojs/reactive define failed: ${err.message}`);
                return null;
            }
        }
        const innerHTML = '<span data-bind="count">0</span>';
        return {
            name: '@mastrojs/reactive',
            create1000: null,
            update1000: null,
            customElement: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    for (let i = 0; i < N_ELEMENTS; i++) {
                        const el = document.createElement(tag);
                        el.innerHTML = innerHTML;
                        state.c.appendChild(el);
                    }
                },
            },
            deepTree: null,
            deepTreeUpdate: null,
        };
    })();

// lit-html ----------------------------------------------------------------
const litAdapter =
    lit &&
    (() => {
        const { html, render } = lit;
        if (typeof html !== 'function' || typeof render !== 'function') {
            console.warn('[bench] lit-html adapter disabled: missing html/render exports');
            return null;
        }
        const tag = 'x-counter-lit';
        if (!customElements.get(tag)) {
            class LitCounter extends HTMLElement {
                connectedCallback() {
                    render(html`<span>count: ${0}</span>`, this);
                }
            }
            customElements.define(tag, LitCounter);
        }
        function tmpl(v) {
            const items = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) items[i] = html`<div>item ${i}-${v}</div>`;
            return html`${items}`;
        }
        function deepNode(depth, label) {
            if (depth === 0) return html`<span>${label}</span>`;
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) children[i] = deepNode(depth - 1, label + '.' + i);
            return html`<div>${children}</div>`;
        }
        return {
            name: 'lit-html',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    const items = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) items[i] = html`<div>item ${i}</div>`;
                    render(html`${items}`, state.c);
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const state = { c, v: 0 };
                    render(tmpl(state.v), c);
                    return state;
                },
                run(state) {
                    state.v++;
                    render(tmpl(state.v), state.c);
                },
            },
            customElement: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                },
            },
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    render(deepNode(DEEP_DEPTH, '0'), state.c);
                },
            },
            deepTreeUpdate: {
                // Strategy A: re-render with new root label; lit-html diffs the
                // text holes inside the same TemplateInstance.
                setup() {
                    const c = makeContainer();
                    const s = { c, label: 'A' };
                    render(deepNode(DEEP_DEPTH, s.label), c);
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    render(deepNode(DEEP_DEPTH, state.label), state.c);
                },
            },
        };
    })();

// voby --------------------------------------------------------------------
const vobyAdapter =
    voby &&
    (() => {
        const h = voby.h ?? voby.default?.h;
        const render = voby.render ?? voby.default?.render;
        const $ = voby.$ ?? voby.default?.$;
        if (typeof h !== 'function' || typeof render !== 'function' || typeof $ !== 'function') {
            console.warn('[bench] voby adapter disabled: missing h/render/$ exports');
            return null;
        }
        const tag = 'x-counter-voby';
        if (!customElements.get(tag)) {
            try {
                class VobyCounter extends HTMLElement {
                    connectedCallback() {
                        this._dispose = render(h('span', {}, 'count: 0'), this);
                    }
                    disconnectedCallback() {
                        try {
                            this._dispose?.();
                        } catch {
                            /* ignore */
                        }
                    }
                }
                customElements.define(tag, VobyCounter);
            } catch (err) {
                console.warn(`[bench] voby define failed: ${err.message}`);
            }
        }
        function VobyDeepNode(props) {
            if (props.depth === 0) return h('span', {}, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(VobyDeepNode, { depth: props.depth - 1, label: props.label + '.' + i });
            }
            return h('div', {}, children);
        }
        // Strategy B: a per-setup signal threaded down to every leaf via a
        // thunk so voby binds a reactive text node. Keeping the signal scoped
        // to setup() means the signal's subscriber list cannot leak across
        // re-mounts (the prior tree may not GC its subscriptions immediately).
        function makeVobyDeepReactiveNode(labelSig) {
            function Node(depth) {
                if (depth === 0) return h('span', {}, () => labelSig());
                const children = new Array(DEEP_BREADTH);
                for (let i = 0; i < DEEP_BREADTH; i++) children[i] = Node(depth - 1);
                return h('div', {}, children);
            }
            return Node;
        }
        return {
            name: 'voby',
            create1000: {
                async: true,
                setup() {
                    return { c: makeContainer(), dispose: null };
                },
                async run(state) {
                    try {
                        state.dispose?.();
                    } catch {
                        /* ignore */
                    }
                    resetContainer(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', {}, `item ${i}`);
                    state.dispose = render(h('div', {}, children), state.c);
                },
            },
            update1000: (() => {
                // voby reactive update: build N signals fresh per setup so the
                // signals can't accumulate subscribers across re-mounts.
                return {
                    async: true,
                    setup() {
                        const c = makeContainer();
                        const signals = new Array(N_ITEMS);
                        for (let i = 0; i < N_ITEMS; i++) signals[i] = $(`item ${i}-0`);
                        const children = new Array(N_ITEMS);
                        for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', {}, signals[i]);
                        const dispose = render(h('div', {}, children), c);
                        return { c, v: 0, signals, dispose };
                    },
                    async run(state) {
                        state.v++;
                        const signals = state.signals;
                        for (let i = 0; i < N_ITEMS; i++) signals[i](`item ${i}-${state.v}`);
                    },
                    teardown(state) {
                        try {
                            state.dispose?.();
                        } catch {
                            /* ignore */
                        }
                        state.c?.replaceChildren?.();
                        state.c?.remove?.();
                    },
                };
            })(),
            customElement: customElements.get(tag)
                ? {
                      async: true,
                      setup() {
                          return { c: makeContainer() };
                      },
                      async run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                async: true,
                setup() {
                    return { c: makeContainer(), dispose: null };
                },
                async run(state) {
                    try {
                        state.dispose?.();
                    } catch {
                        /* ignore */
                    }
                    resetContainer(state.c);
                    state.dispose = render(h(VobyDeepNode, { depth: DEEP_DEPTH, label: '0' }), state.c);
                },
            },
            deepTreeUpdate: {
                async: true,
                setup() {
                    const c = makeContainer();
                    const labelSig = $('A');
                    const Node = makeVobyDeepReactiveNode(labelSig);
                    const dispose = render(Node(DEEP_DEPTH), c);
                    return { c, label: 'A', labelSig, dispose };
                },
                async run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    state.labelSig(state.label);
                },
                teardown(state) {
                    try {
                        state.dispose?.();
                    } catch {
                        /* ignore */
                    }
                    state.c?.replaceChildren?.();
                    state.c?.remove?.();
                },
            },
        };
    })();

// vanjs-core --------------------------------------------------------------
const vanAdapter =
    vanMod &&
    (() => {
        const van = vanMod.default ?? vanMod;
        if (!van || !van.tags || typeof van.add !== 'function' || typeof van.state !== 'function') {
            console.warn('[bench] vanjs-core adapter disabled: missing tags/add/state');
            return null;
        }
        const { div, span } = van.tags;
        const tag = 'x-counter-van';
        if (!customElements.get(tag)) {
            class VanCounter extends HTMLElement {
                connectedCallback() {
                    van.add(this, span('count: 0'));
                }
            }
            customElements.define(tag, VanCounter);
        }
        function vanDeepNode(depth, label) {
            if (depth === 0) return span(label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) children[i] = vanDeepNode(depth - 1, label + '.' + i);
            return div(...children);
        }
        // Strategy B: build a tree bound to a per-setup van.state so the state's
        // subscriber list cannot accumulate across re-mounts (vanjs uses WeakRefs
        // internally, but GC of detached subscribers is not deterministic).
        function makeVanDeepReactiveNode(labelState) {
            function Node(depth) {
                if (depth === 0) return span(labelState);
                const children = new Array(DEEP_BREADTH);
                for (let i = 0; i < DEEP_BREADTH; i++) children[i] = Node(depth - 1);
                return div(...children);
            }
            return Node;
        }
        return {
            name: 'vanjs-core',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = div(`item ${i}`);
                    van.add(state.c, ...children);
                },
            },
            update1000: (() => {
                return {
                    async: true,
                    setup() {
                        const c = makeContainer();
                        const states = new Array(N_ITEMS);
                        for (let i = 0; i < N_ITEMS; i++) states[i] = van.state(`item ${i}-0`);
                        const children = new Array(N_ITEMS);
                        for (let i = 0; i < N_ITEMS; i++) children[i] = div(states[i]);
                        van.add(c, ...children);
                        return { c, v: 0, states };
                    },
                    async run(state) {
                        state.v++;
                        const states = state.states;
                        for (let i = 0; i < N_ITEMS; i++) states[i].val = `item ${i}-${state.v}`;
                    },
                    teardown(state) {
                        state.c?.replaceChildren?.();
                        state.c?.remove?.();
                    },
                };
            })(),
            customElement: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                },
            },
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    resetContainer(state.c);
                    van.add(state.c, vanDeepNode(DEEP_DEPTH, '0'));
                },
            },
            deepTreeUpdate: {
                async: true,
                setup() {
                    const c = makeContainer();
                    const labelState = van.state('A');
                    const Node = makeVanDeepReactiveNode(labelState);
                    van.add(c, Node(DEEP_DEPTH));
                    return { c, label: 'A', labelState };
                },
                async run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    state.labelState.val = state.label;
                },
                teardown(state) {
                    state.c?.replaceChildren?.();
                    state.c?.remove?.();
                },
            },
        };
    })();

// solid-js ----------------------------------------------------------------

const solidAdapter =
    solidWeb &&
    solidH &&
    solid &&
    (() => {
        const render = solidWeb.render;
        const h = solidH.default ?? solidH;
        const createSignal = solid.createSignal;
        const createRoot = solid.createRoot;
        if (
            typeof render !== 'function' ||
            typeof h !== 'function' ||
            typeof createSignal !== 'function' ||
            typeof createRoot !== 'function'
        ) {
            console.warn('[bench] solid-js adapter disabled: missing render/h/createSignal/createRoot');
            return null;
        }
        const tag = 'x-counter-solid';
        let elementOk = false;
        if (!customElements.get(tag)) {
            try {
                class SolidCounter extends HTMLElement {
                    connectedCallback() {
                        this._dispose = render(() => h('span', {}, 'count: 0'), this);
                    }
                    disconnectedCallback() {
                        try {
                            this._dispose?.();
                        } catch {
                            /* ignore */
                        }
                    }
                }
                customElements.define(tag, SolidCounter);
                elementOk = true;
            } catch (err) {
                console.warn(`[bench] solid-js define failed: ${err.message}`);
            }
        } else {
            elementOk = true;
        }
        // Smoke-test create-1000 path so we can fail fast.
        let create1000Ok = true;
        try {
            const probe = document.createElement('div');
            const dispose = render(() => h('div', {}, 'probe'), probe);
            dispose?.();
        } catch (err) {
            console.warn(`[bench] solid-js create-1000 disabled: ${err.message}`);
            create1000Ok = false;
        }
        function SolidDeepNode(props) {
            if (props.depth === 0) return h('span', {}, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(SolidDeepNode, { depth: props.depth - 1, label: props.label + '.' + i });
            }
            return h('div', {}, children);
        }
        // Strategy B: the signal is created per setup inside a createRoot so the
        // signal's subscriber list cannot leak across re-mounts. The factory
        // builds the recursive tree closure over the per-setup getter.
        function makeSolidDeepReactiveNode(label) {
            function Node(depth) {
                if (depth === 0) return h('span', {}, label);
                const children = new Array(DEEP_BREADTH);
                for (let i = 0; i < DEEP_BREADTH; i++) children[i] = Node(depth - 1);
                return h('div', {}, children);
            }
            return Node;
        }
        return {
            name: 'solid-js',
            create1000: create1000Ok
                ? {
                      setup() {
                          return { c: makeContainer(), dispose: null };
                      },
                      run(state) {
                          try {
                              state.dispose?.();
                          } catch {
                              /* ignore */
                          }
                          resetContainer(state.c);
                          state.dispose = render(() => {
                              const children = new Array(N_ITEMS);
                              for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', {}, `item ${i}`);
                              return children;
                          }, state.c);
                      },
                  }
                : null,
            update1000: create1000Ok
                ? (() => {
                      const sigs = new Array(N_ITEMS);
                      return {
                          async: true,
                          setup() {
                              const c = makeContainer();
                              for (let i = 0; i < N_ITEMS; i++) sigs[i] = createSignal(`item ${i}-0`);
                              const dispose = render(() => {
                                  const children = new Array(N_ITEMS);
                                  for (let i = 0; i < N_ITEMS; i++) {
                                      const [get] = sigs[i];
                                      children[i] = h('div', {}, get);
                                  }
                                  return children;
                              }, c);
                              return { c, v: 0, dispose };
                          },
                          async run(state) {
                              state.v++;
                              for (let i = 0; i < N_ITEMS; i++) sigs[i][1](`item ${i}-${state.v}`);
                          },
                      };
                  })()
                : null,
            customElement:
                elementOk && create1000Ok
                    ? {
                          setup() {
                              return { c: makeContainer() };
                          },
                          run(state) {
                              resetContainer(state.c);
                              for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                          },
                      }
                    : null,
            deepTree: create1000Ok
                ? {
                      setup() {
                          return { c: makeContainer(), dispose: null };
                      },
                      run(state) {
                          try {
                              state.dispose?.();
                          } catch {
                              /* ignore */
                          }
                          resetContainer(state.c);
                          state.dispose = render(() => h(SolidDeepNode, { depth: DEEP_DEPTH, label: '0' }), state.c);
                      },
                  }
                : null,
            deepTreeUpdate: create1000Ok
                ? {
                      setup() {
                          const c = makeContainer();
                          let setLabel;
                          let rootDispose;
                          let renderDispose;
                          createRoot(d => {
                              rootDispose = d;
                              const [label, set] = createSignal('A');
                              setLabel = set;
                              const Node = makeSolidDeepReactiveNode(label);
                              renderDispose = render(() => Node(DEEP_DEPTH), c);
                          });
                          return { c, label: 'A', setLabel, rootDispose, renderDispose };
                      },
                      run(state) {
                          state.label = state.label === 'A' ? 'B' : 'A';
                          state.setLabel(state.label);
                      },
                      teardown(state) {
                          try {
                              state.renderDispose?.();
                          } catch {
                              /* ignore */
                          }
                          try {
                              state.rootDispose?.();
                          } catch {
                              /* ignore */
                          }
                          state.c?.replaceChildren?.();
                          state.c?.remove?.();
                      },
                  }
                : null,
        };
    })();

// preact ------------------------------------------------------------------
const preactAdapter =
    preact &&
    (() => {
        const { h, render } = preact;
        if (typeof h !== 'function' || typeof render !== 'function') {
            console.warn('[bench] preact adapter disabled: missing h/render exports');
            return null;
        }
        const tag = 'x-counter-preact';
        if (!customElements.get(tag)) {
            try {
                class PreactCounter extends HTMLElement {
                    connectedCallback() {
                        render(h('div', null, 'preact'), this);
                    }
                    disconnectedCallback() {
                        try {
                            render(null, this);
                        } catch {
                            /* ignore */
                        }
                    }
                }
                customElements.define(tag, PreactCounter);
            } catch (err) {
                console.warn(`[bench] preact define failed: ${err.message}`);
            }
        }
        return {
            name: 'preact',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    render(null, state.c);
                    resetContainer(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', null, `item ${i}`);
                    render(h('div', null, children), state.c);
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const state = { c, v: 0 };
                    renderPreact(state);
                    return state;
                },
                run(state) {
                    state.v++;
                    renderPreact(state);
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    render(null, state.c);
                    resetContainer(state.c);
                    render(h(PreactDeepNode, { depth: DEEP_DEPTH, label: '0' }), state.c);
                },
            },
            deepTreeUpdate: {
                // Strategy A: pre-render once, then call preact's render() with a
                // new root label prop. Preact's diff walks to every leaf.
                setup() {
                    const c = makeContainer();
                    const s = { c, label: 'A' };
                    render(h(PreactDeepNode, { depth: DEEP_DEPTH, label: s.label }), c);
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    render(h(PreactDeepNode, { depth: DEEP_DEPTH, label: state.label }), state.c);
                },
            },
        };

        function renderPreact(state) {
            const children = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', null, `item ${i}-${state.v}`);
            render(h('div', null, children), state.c);
        }
        function PreactDeepNode(props) {
            if (props.depth === 0) return h('span', null, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(PreactDeepNode, { key: i, depth: props.depth - 1, label: props.label + '.' + i });
            }
            return h('div', null, children);
        }
    })();

// mithril -----------------------------------------------------------------
const mithrilAdapter =
    mithril &&
    (() => {
        const m = mithril.default ?? mithril;
        if (typeof m !== 'function' || typeof m.render !== 'function') {
            console.warn('[bench] mithril adapter disabled: missing m/m.render');
            return null;
        }
        const tag = 'x-counter-mithril';
        if (!customElements.get(tag)) {
            try {
                class MithrilCounter extends HTMLElement {
                    connectedCallback() {
                        m.render(this, m('div', 'mithril'));
                    }
                    disconnectedCallback() {
                        try {
                            m.render(this, null);
                        } catch {
                            /* ignore */
                        }
                    }
                }
                customElements.define(tag, MithrilCounter);
            } catch (err) {
                console.warn(`[bench] mithril define failed: ${err.message}`);
            }
        }
        return {
            name: 'mithril',
            create1000: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    m.render(state.c, null);
                    resetContainer(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = m('div', `item ${i}`);
                    m.render(state.c, children);
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const state = { c, v: 0 };
                    renderMithril(state);
                    return state;
                },
                run(state) {
                    state.v++;
                    renderMithril(state);
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                setup() {
                    return { c: makeContainer() };
                },
                run(state) {
                    m.render(state.c, null);
                    resetContainer(state.c);
                    m.render(state.c, mithrilDeepNode(DEEP_DEPTH, '0'));
                },
            },
            deepTreeUpdate: {
                // Strategy A: pre-render, then re-render with a new root label.
                setup() {
                    const c = makeContainer();
                    const s = { c, label: 'A' };
                    m.render(c, mithrilDeepNode(DEEP_DEPTH, s.label));
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    m.render(state.c, mithrilDeepNode(DEEP_DEPTH, state.label));
                },
            },
        };

        function renderMithril(state) {
            const children = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) children[i] = m('div', `item ${i}-${state.v}`);
            m.render(state.c, children);
        }
        function mithrilDeepNode(depth, label) {
            if (depth === 0) return m('span', label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) children[i] = mithrilDeepNode(depth - 1, label + '.' + i);
            return m('div', children);
        }
    })();

// snabbdom ----------------------------------------------------------------
const snabbdomAdapter =
    snabbdom &&
    (() => {
        const { init, h, classModule, propsModule, attributesModule, eventListenersModule } = snabbdom;
        if (typeof init !== 'function' || typeof h !== 'function') {
            console.warn('[bench] snabbdom adapter disabled: missing init/h exports');
            return null;
        }
        const patch = init([classModule, propsModule, attributesModule, eventListenersModule]);
        const tag = 'x-counter-snabbdom';
        if (!customElements.get(tag)) {
            try {
                class SnabbdomCounter extends HTMLElement {
                    connectedCallback() {
                        const slot = document.createElement('div');
                        this.appendChild(slot);
                        this._vnode = patch(slot, h('div', {}, 'snabbdom'));
                    }
                    disconnectedCallback() {
                        try {
                            if (this._vnode) patch(this._vnode, h('!', {}, []));
                        } catch {
                            /* ignore */
                        }
                        this._vnode = null;
                    }
                }
                customElements.define(tag, SnabbdomCounter);
            } catch (err) {
                console.warn(`[bench] snabbdom define failed: ${err.message}`);
            }
        }
        function buildVnode(v) {
            const children = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', {}, `item ${i}-${v}`);
            return h('div#root', {}, children);
        }
        function snabbdomDeepNode(depth, label) {
            if (depth === 0) return h('span', {}, label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) children[i] = snabbdomDeepNode(depth - 1, label + '.' + i);
            return h('div', {}, children);
        }
        return {
            name: 'snabbdom',
            create1000: {
                setup() {
                    return { c: makeContainer(), vnode: null };
                },
                run(state) {
                    // tear down any previous vnode, then patch a fresh slot.
                    if (state.vnode) {
                        try {
                            patch(state.vnode, h('!', {}, []));
                        } catch {
                            /* ignore */
                        }
                        state.vnode = null;
                    }
                    resetContainer(state.c);
                    const slot = state.c.appendChild(document.createElement('div'));
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', {}, `item ${i}`);
                    state.vnode = patch(slot, h('div#root', {}, children));
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const slot = c.appendChild(document.createElement('div'));
                    const vnode = patch(slot, buildVnode(0));
                    return { c, v: 0, vnode };
                },
                run(state) {
                    state.v++;
                    state.vnode = patch(state.vnode, buildVnode(state.v));
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                setup() {
                    return { c: makeContainer(), vnode: null };
                },
                run(state) {
                    if (state.vnode) {
                        try {
                            patch(state.vnode, h('!', {}, []));
                        } catch {
                            /* ignore */
                        }
                        state.vnode = null;
                    }
                    resetContainer(state.c);
                    const slot = state.c.appendChild(document.createElement('div'));
                    state.vnode = patch(slot, snabbdomDeepNode(DEEP_DEPTH, '0'));
                },
            },
            deepTreeUpdate: {
                // Strategy A: keep the previous vnode and patch into a new tree
                // built with the toggled label.
                setup() {
                    const c = makeContainer();
                    const slot = c.appendChild(document.createElement('div'));
                    const s = { c, label: 'A', vnode: null };
                    s.vnode = patch(slot, snabbdomDeepNode(DEEP_DEPTH, s.label));
                    return s;
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    state.vnode = patch(state.vnode, snabbdomDeepNode(DEEP_DEPTH, state.label));
                },
            },
        };
    })();

// @slimlib/jsx ------------------------------------------------------------
const slimlibAdapter =
    slimlibJsx &&
    slimlibStore &&
    (() => {
        const { createElement: h, render, Fragment } = slimlibJsx;
        const { signal } = slimlibStore;
        if (typeof h !== 'function' || typeof render !== 'function') {
            console.warn('[bench] @slimlib/jsx adapter disabled: missing createElement/render');
            return null;
        }
        const tag = 'x-counter-slimlib';
        if (!customElements.get(tag)) {
            try {
                class SlimlibCounter extends HTMLElement {
                    connectedCallback() {
                        this._dispose = render(() => h('div', null, 'slimlib'), this);
                    }
                    disconnectedCallback() {
                        try {
                            this._dispose?.();
                        } catch {
                            /* ignore */
                        }
                    }
                }
                customElements.define(tag, SlimlibCounter);
            } catch (err) {
                console.warn(`[bench] @slimlib/jsx define failed: ${err.message}`);
            }
        }

        // Deep tree component (static).
        function SlimDeepNode(props) {
            if (props.depth === 0) return h('span', null, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(SlimDeepNode, { depth: props.depth - 1, label: `${props.label}.${i}` });
            }
            return h('div', null, children);
        }

        return {
            name: '@slimlib/jsx',
            create1000: {
                setup() {
                    return { c: makeContainer(), dispose: null };
                },
                run(state) {
                    state.dispose?.();
                    resetContainer(state.c);
                    state.dispose = render(
                        () => {
                            const children = new Array(N_ITEMS);
                            for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', null, `item ${i}`);
                            return h('div', null, children);
                        },
                        state.c,
                    );
                    drainSlimlib();
                },
            },
            update1000: {
                // Strategy B: build once with reactive children driven by a signal; update by setting the signal.
                async: true,
                setup() {
                    const c = makeContainer();
                    const v = signal(0);
                    const dispose = render(
                        () => {
                            const children = new Array(N_ITEMS);
                            for (let i = 0; i < N_ITEMS; i++) {
                                const idx = i;
                                children[i] = h('div', null, () => `item ${idx}-${v()}`);
                            }
                            return h('div', null, children);
                        },
                        c,
                    );
                    drainSlimlib();
                    return { c, v, dispose };
                },
                run(state) {
                    state.v.set(state.v() + 1);
                    drainSlimlib();
                },
                teardown(state) {
                    state.dispose?.();
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                setup() {
                    return { c: makeContainer(), dispose: null };
                },
                run(state) {
                    state.dispose?.();
                    resetContainer(state.c);
                    state.dispose = render(() => h(SlimDeepNode, { depth: DEEP_DEPTH, label: '0' }), state.c);
                    drainSlimlib();
                },
            },
            // deep-tree-update: Strategy B — reactive label at the root signal feeds every leaf.
            deepTreeUpdate: {
                async: true,
                setup() {
                    const c = makeContainer();
                    const label = signal('A');
                    function DeepReactive(props) {
                        if (props.depth === 0) return h('span', null, () => `${label()}${props.suffix}`);
                        const children = new Array(DEEP_BREADTH);
                        for (let i = 0; i < DEEP_BREADTH; i++) {
                            children[i] = h(DeepReactive, { depth: props.depth - 1, suffix: `${props.suffix}.${i}` });
                        }
                        return h('div', null, children);
                    }
                    const dispose = render(() => h(DeepReactive, { depth: DEEP_DEPTH, suffix: '' }), c);
                    drainSlimlib();
                    return { c, label, dispose };
                },
                run(state) {
                    state.label.set(state.label() === 'A' ? 'B' : 'A');
                    drainSlimlib();
                },
                teardown(state) {
                    state.dispose?.();
                },
            },
            // Keyed scenarios not yet supported (no list-reconciliation algorithm).
            swapRows: null,
            shuffle1000: null,
            appendTail: null,
            prependHead: null,
            updateTail: null,
        };
    })();

// @slimlib/jsx (sync scheduler) ------------------------------------------
// Wraps slimlibAdapter so each setup/run/teardown switches the @slimlib/store
// scheduler to a synchronous one (fn => fn()) and restores the default
// (queueMicrotask captured before any probe patching) afterwards. This lets
// us measure the cost of skipping the default microtask batch without
// affecting the default-scheduler @slimlib/jsx run.
const slimlibSyncAdapter =
    slimlibAdapter &&
    slimlibStore &&
    (() => {
        const { setScheduler } = slimlibStore;
        // Capture the original queueMicrotask before the probe ever patches it.
        const defaultSched = queueMicrotask.bind(globalThis);
        const syncSched = fn => fn();
        function withSync(fn) {
            return function (...args) {
                setScheduler(syncSched);
                drainSlimlib = noopDrainSlimlib;
                const restore = () => {
                    setScheduler(defaultSched);
                    drainSlimlib = realDrainSlimlib;
                };
                let returnedPromise = false;
                try {
                    const r = fn.apply(this, args);
                    if (r && typeof r.then === 'function') {
                        returnedPromise = true;
                        return r.finally(restore);
                    }
                    return r;
                } finally {
                    if (!returnedPromise) restore();
                }
            };
        }
        function wrap(inner) {
            if (!inner) return null;
            const w = inner.async ? { async: true } : {};
            if (inner.setup) w.setup = withSync(inner.setup);
            if (inner.run) w.run = withSync(inner.run);
            if (inner.teardown) w.teardown = withSync(inner.teardown);
            return w;
        }
        return {
            name: '@slimlib/jsx (sync)',
            create1000: wrap(slimlibAdapter.create1000),
            update1000: wrap(slimlibAdapter.update1000),
            customElement: wrap(slimlibAdapter.customElement),
            deepTree: wrap(slimlibAdapter.deepTree),
            deepTreeUpdate: wrap(slimlibAdapter.deepTreeUpdate),
            swapRows: null,
            shuffle1000: null,
            appendTail: null,
            prependHead: null,
            updateTail: null,
        };
    })();

// react -------------------------------------------------------------------
const reactAdapter =
    reactMod &&
    reactDomClient &&
    reactDom &&
    (() => {
        const React = reactMod.default ?? reactMod;
        const createElement = React.createElement;
        const createRoot = reactDomClient.createRoot;
        const flushSync = reactDom.flushSync;
        if (
            typeof createElement !== 'function' ||
            typeof createRoot !== 'function' ||
            typeof flushSync !== 'function'
        ) {
            console.warn('[bench] react adapter disabled: missing createElement/createRoot/flushSync');
            return null;
        }
        function ReactDeepNode(props) {
            if (props.depth === 0) return createElement('span', null, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = createElement(ReactDeepNode, {
                    key: i,
                    depth: props.depth - 1,
                    label: props.label + '.' + i,
                });
            }
            return createElement('div', null, children);
        }
        function renderList(root, v) {
            const children = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) children[i] = createElement('div', { key: i }, `item ${i}-${v}`);
            flushSync(() => root.render(createElement('div', null, children)));
        }
        return {
            name: 'react',
            create1000: {
                setup() {
                    return { c: makeContainer(), root: null };
                },
                run(state) {
                    if (state.root) {
                        try {
                            state.root.unmount();
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.root = createRoot(state.c);
                    const children = new Array(N_ITEMS);
                    for (let i = 0; i < N_ITEMS; i++) children[i] = createElement('div', { key: i }, `item ${i}`);
                    flushSync(() => state.root.render(createElement('div', null, children)));
                },
                teardown(state) {
                    try {
                        state.root?.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const root = createRoot(c);
                    renderList(root, 0);
                    return { c, root, v: 0 };
                },
                run(state) {
                    state.v++;
                    renderList(state.root, state.v);
                },
                teardown(state) {
                    try {
                        state.root.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            // React does not idiomatically define custom elements (no first-class
            // API). Skip the scenario.
            customElement: null,
            deepTree: {
                setup() {
                    return { c: makeContainer(), root: null };
                },
                run(state) {
                    if (state.root) {
                        try {
                            state.root.unmount();
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.root = createRoot(state.c);
                    flushSync(() =>
                        state.root.render(createElement(ReactDeepNode, { depth: DEEP_DEPTH, label: '0' })),
                    );
                },
                teardown(state) {
                    try {
                        state.root?.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            deepTreeUpdate: {
                setup() {
                    const c = makeContainer();
                    const root = createRoot(c);
                    flushSync(() => root.render(createElement(ReactDeepNode, { depth: DEEP_DEPTH, label: 'A' })));
                    return { c, root, label: 'A' };
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    flushSync(() =>
                        state.root.render(createElement(ReactDeepNode, { depth: DEEP_DEPTH, label: state.label })),
                    );
                },
                teardown(state) {
                    try {
                        state.root.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
        };
    })();

// vue ---------------------------------------------------------------------
const vueAdapter =
    vueMod &&
    (() => {
        const { h, createApp, ref, nextTick, defineCustomElement } = vueMod;
        if (typeof h !== 'function' || typeof createApp !== 'function') {
            console.warn('[bench] vue adapter disabled: missing h/createApp');
            return null;
        }
        const tag = 'x-counter-vue';
        if (typeof defineCustomElement === 'function' && !customElements.get(tag)) {
            try {
                const VueCounter = defineCustomElement({
                    render() {
                        return h('span', null, 'count: 0');
                    },
                });
                customElements.define(tag, VueCounter);
            } catch (err) {
                console.warn(`[bench] vue defineCustomElement failed: ${err.message}`);
            }
        }
        function VueDeepNode(props) {
            if (props.depth === 0) return h('span', null, props.label);
            const children = new Array(DEEP_BREADTH);
            for (let i = 0; i < DEEP_BREADTH; i++) {
                children[i] = h(VueDeepNode, {
                    key: i,
                    depth: props.depth - 1,
                    label: props.label + '.' + i,
                });
            }
            return h('div', null, children);
        }
        return {
            name: 'vue',
            create1000: {
                async: true,
                setup() {
                    return { c: makeContainer(), app: null };
                },
                async run(state) {
                    if (state.app) {
                        try {
                            state.app.unmount();
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.app = createApp({
                        render() {
                            const children = new Array(N_ITEMS);
                            for (let i = 0; i < N_ITEMS; i++) children[i] = h('div', { key: i }, `item ${i}`);
                            return h('div', null, children);
                        },
                    });
                    state.app.mount(state.c);
                    await nextTick();
                },
                teardown(state) {
                    try {
                        state.app?.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            update1000: {
                async: true,
                setup() {
                    const c = makeContainer();
                    const v = ref(0);
                    const app = createApp({
                        setup() {
                            return () => {
                                const cur = v.value;
                                const children = new Array(N_ITEMS);
                                for (let i = 0; i < N_ITEMS; i++)
                                    children[i] = h('div', { key: i }, `item ${i}-${cur}`);
                                return h('div', null, children);
                            };
                        },
                    });
                    app.mount(c);
                    return { c, app, v };
                },
                async run(state) {
                    state.v.value++;
                    await nextTick();
                },
                teardown(state) {
                    try {
                        state.app.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            customElement: customElements.get(tag)
                ? {
                      setup() {
                          return { c: makeContainer() };
                      },
                      run(state) {
                          resetContainer(state.c);
                          for (let i = 0; i < N_ELEMENTS; i++) state.c.appendChild(document.createElement(tag));
                      },
                  }
                : null,
            deepTree: {
                async: true,
                setup() {
                    return { c: makeContainer(), app: null };
                },
                async run(state) {
                    if (state.app) {
                        try {
                            state.app.unmount();
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.app = createApp({
                        render: () => h(VueDeepNode, { depth: DEEP_DEPTH, label: '0' }),
                    });
                    state.app.mount(state.c);
                    await nextTick();
                },
                teardown(state) {
                    try {
                        state.app?.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            deepTreeUpdate: {
                async: true,
                setup() {
                    const c = makeContainer();
                    const label = ref('A');
                    const app = createApp({
                        setup() {
                            return () => h(VueDeepNode, { depth: DEEP_DEPTH, label: label.value });
                        },
                    });
                    app.mount(c);
                    return { c, app, label };
                },
                async run(state) {
                    state.label.value = state.label.value === 'A' ? 'B' : 'A';
                    await nextTick();
                },
                teardown(state) {
                    try {
                        state.app.unmount();
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
        };
    })();

// svelte 5 ---------------------------------------------------------------
const svelteAdapter =
    svelteMod &&
    svelteListMod &&
    svelteDeepTreeMod &&
    (() => {
        const mount = svelteMod.mount;
        const unmount = svelteMod.unmount;
        const flushSync = svelteMod.flushSync;
        const List = svelteListMod.default;
        const DeepTreeApp = svelteDeepTreeMod.default;
        if (typeof mount !== 'function' || typeof unmount !== 'function' || typeof flushSync !== 'function' || !List || !DeepTreeApp) {
            console.warn('[bench] svelte adapter disabled: missing mount/unmount/flushSync or components');
            return null;
        }
        // Custom element scenario for svelte requires `<svelte:options
        // customElement="..." />` plus per-file customElement compilation.
        // Skipping rather than wiring a parallel compiler pass.
        function buildItems(v) {
            const arr = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) arr[i] = `item ${i}-${v}`;
            return arr;
        }
        function buildCreateItems() {
            const arr = new Array(N_ITEMS);
            for (let i = 0; i < N_ITEMS; i++) arr[i] = `item ${i}`;
            return arr;
        }
        return {
            name: 'svelte',
            create1000: {
                setup() {
                    return { c: makeContainer(), instance: null };
                },
                run(state) {
                    if (state.instance) {
                        try {
                            unmount(state.instance);
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.instance = mount(List, { target: state.c, props: {} });
                    state.instance.setItems(buildCreateItems());
                    flushSync();
                },
                teardown(state) {
                    try {
                        if (state.instance) unmount(state.instance);
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            update1000: {
                setup() {
                    const c = makeContainer();
                    const instance = mount(List, { target: c, props: {} });
                    instance.setItems(buildItems(0));
                    flushSync();
                    return { c, instance, v: 0 };
                },
                run(state) {
                    state.v++;
                    state.instance.setItems(buildItems(state.v));
                    flushSync();
                },
                teardown(state) {
                    try {
                        unmount(state.instance);
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            customElement: null,
            deepTree: {
                setup() {
                    return { c: makeContainer(), instance: null };
                },
                run(state) {
                    if (state.instance) {
                        try {
                            unmount(state.instance);
                        } catch {
                            /* ignore */
                        }
                    }
                    resetContainer(state.c);
                    state.instance = mount(DeepTreeApp, {
                        target: state.c,
                        props: { depth: DEEP_DEPTH, breadth: DEEP_BREADTH, initialLabel: '0' },
                    });
                    flushSync();
                },
                teardown(state) {
                    try {
                        if (state.instance) unmount(state.instance);
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
            deepTreeUpdate: {
                setup() {
                    const c = makeContainer();
                    const instance = mount(DeepTreeApp, {
                        target: c,
                        props: { depth: DEEP_DEPTH, breadth: DEEP_BREADTH, initialLabel: 'A' },
                    });
                    flushSync();
                    return { c, instance, label: 'A' };
                },
                run(state) {
                    state.label = state.label === 'A' ? 'B' : 'A';
                    state.instance.setLabel(state.label);
                    flushSync();
                },
                teardown(state) {
                    try {
                        unmount(state.instance);
                    } catch {
                        /* ignore */
                    }
                    state.c?.remove?.();
                },
            },
        };
    })();


// ===== keyed list-reconciliation scenarios ===============================
// Inspired by js-framework-benchmark: each lib must use its idiomatic keyed
// path so existing DOM nodes are moved (not recreated) when the array order
// changes. Every iteration toggles between the sorted (orderA) and
// reordered (orderB) arrays so reconciliation runs both directions.

const KEYED_N = 1000;

function makeKeyedItems() {
    const arr = new Array(KEYED_N);
    for (let i = 0; i < KEYED_N; i++) arr[i] = { id: i, label: `row ${i}` };
    return arr;
}

function makeSwappedOrder(items) {
    const arr = items.slice();
    const t = arr[1];
    arr[1] = arr[998];
    arr[998] = t;
    return arr;
}

// Seeded Fisher-Yates so every process gets the same shuffle.
function makeShuffledOrder(items) {
    const arr = items.slice();
    let s = 0x12345678 >>> 0;
    const rnd = () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s >>>= 0;
        s ^= s << 5;
        s >>>= 0;
        return s / 0x100000000;
    };
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
    }
    return arr;
}

const baseItems = makeKeyedItems();
const swappedOrder = makeSwappedOrder(baseItems);
const shuffledOrder = makeShuffledOrder(baseItems);
const appendTailOrder = baseItems.concat({ id: 1000, label: 'row 1000' });
const prependHeadOrder = [{ id: -1, label: 'row -1' }, ...baseItems];
// updateTailOrder shares 999 element identities with baseItems; only the last
// item is a fresh object with a different label so reactive text updates fire
// while keys stay stable.
const updateTailOrder = baseItems.slice(0, KEYED_N - 1).concat({ id: KEYED_N - 1, label: 'updated' });

// Generic shape: init(c) -> ctx; apply(ctx, items) re-renders that order.
function makeKeyedAdapter(name, init, apply) {
    function build(orderB) {
        return {
            setup() {
                const c = makeContainer();
                const ctx = init(c);
                return { ctx, toggle: false };
            },
            run(state) {
                state.toggle = !state.toggle;
                apply(state.ctx, state.toggle ? orderB : baseItems);
            },
        };
    }
    return {
        name,
        swapRows: build(swappedOrder),
        shuffle1000: build(shuffledOrder),
        appendTail: build(appendTailOrder),
        prependHead: build(prependHeadOrder),
        updateTail: build(updateTailOrder),
    };
}

// Probe: render initial items, capture node, render reordered items, check
// the same DOM node ended up at the expected new position. Used to decide
// whether nano-jsx (which lacks documented keyed reconciliation) qualifies.
function probeKeyed(renderInitial, renderReordered) {
    const c = document.createElement('div');
    try {
        renderInitial(c);
        const before = c.querySelectorAll('[data-probe]');
        if (before.length < 3) return false;
        const firstNode = before[0];
        renderReordered(c);
        const after = c.querySelectorAll('[data-probe]');
        return after.length === before.length && after[after.length - 1] === firstNode;
    } catch {
        return false;
    }
}

// ---- uhtml (key= attribute in templates) ----
const uhtmlKeyedTmpl = uhtml ? items => uhtml.html`${items.map(it => uhtml.html`<div key=${it.id}>${it.label}</div>`)}` : null;
const uhtmlKeyed = uhtml
    ? makeKeyedAdapter(
          'uhtml',
          c => {
              uhtml.render(c, uhtmlKeyedTmpl(baseItems));
              return c;
          },
          (c, items) => uhtml.render(c, uhtmlKeyedTmpl(items))
      )
    : null;

// ---- lighterhtml (html.for keyed primitive) ----
const lighterKeyed =
    lighter && lighterAdapter
        ? (() => {
              const html = lighter.html;
              const render = lighter.render;
              const tmpl = (scope, items) => html`${items.map(it => html.for(scope, it.id)`<div>${it.label}</div>`)}`;
              // Probe: render initial set, capture node, reorder, check identity.
              let honors = false;
              try {
                  const probe = document.createElement('div');
                  const probeItems = [
                      { id: 'a', label: 'a' },
                      { id: 'b', label: 'b' },
                      { id: 'c', label: 'c' },
                  ];
                  render(probe, () => tmpl(probe, probeItems));
                  const first = probe.firstElementChild;
                  render(probe, () => tmpl(probe, [probeItems[2], probeItems[1], probeItems[0]]));
                  honors = first != null && probe.lastElementChild === first;
              } catch (err) {
                  console.warn(`[bench] lighterhtml keyed probe threw: ${err.message}`);
              }
              if (!honors) {
                  console.warn('[bench] lighterhtml keyed scenarios skipped: html.for did not reuse DOM nodes');
                  return null;
              }
              // Real benchmark: capture row 1's element after 1000-row setup, swap, verify it moved to 998.
              try {
                  const probe = document.createElement('div');
                  render(probe, () => tmpl(probe, baseItems));
                  const row1 = probe.children[1];
                  render(probe, () => tmpl(probe, swappedOrder));
                  if (probe.children[998] !== row1) {
                      console.warn('[bench] lighterhtml keyed scenarios skipped: 1000-row swap did not preserve identity');
                      return null;
                  }
              } catch (err) {
                  console.warn(`[bench] lighterhtml 1000-row probe threw: ${err.message}`);
                  return null;
              }
              function build(orderB) {
                  return {
                      setup() {
                          const c = makeContainer();
                          render(c, () => tmpl(c, baseItems));
                          return { c, toggle: false };
                      },
                      run(state) {
                          state.toggle = !state.toggle;
                          const items = state.toggle ? orderB : baseItems;
                          render(state.c, () => tmpl(state.c, items));
                      },
                  };
              }
              return {
                  name: 'lighterhtml',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- nano-jsx (probe: does it honor keys?) ----
let nanoKeyed = null;
if (nano && nanoAdapter) {
    const Nano = nano.default ?? nano;
    const h = nano.h ?? Nano.h;
    const render = Nano.render ?? nano.render;
    const probeItems = [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
    ];
    const probeTmpl = items =>
        h(
            'div',
            null,
            items.map(it => h('div', { key: it.id, 'data-probe': '' }, it.label))
        );
    const honors = probeKeyed(
        c => render(probeTmpl(probeItems), c),
        c => render(probeTmpl([probeItems[2], probeItems[1], probeItems[0]]), c)
    );
    if (!honors) {
        console.warn('[bench] nano-jsx keyed scenarios skipped: render() does not honor keys for reconciliation');
    } else {
        const tmpl = items =>
            h(
                'div',
                null,
                items.map(it => h('div', { key: it.id }, it.label))
            );
        nanoKeyed = makeKeyedAdapter(
            'nano-jsx',
            c => {
                render(tmpl(baseItems), c);
                return c;
            },
            (c, items) => render(tmpl(items), c)
        );
    }
}

// ---- lit-html (repeat directive) ----
const litKeyed =
    lit && litRepeat
        ? (() => {
              const { html, render } = lit;
              const { repeat } = litRepeat;
              const tmpl = items =>
                  html`${repeat(
                      items,
                      it => it.id,
                      it => html`<div>${it.label}</div>`
                  )}`;
              return makeKeyedAdapter(
                  'lit-html',
                  c => {
                      render(tmpl(baseItems), c);
                      return c;
                  },
                  (c, items) => render(tmpl(items), c)
              );
          })()
        : null;

// ---- voby (For component over a signal) ----
const vobyKeyed =
    voby && voby.For
        ? (() => {
              const h = voby.h,
                  render = voby.render,
                  $ = voby.$,
                  For = voby.For;
              function build(orderB) {
                  return {
                      async: true,
                      setup() {
                          const c = makeContainer();
                          const sig = $(baseItems);
                          const dispose = render(
                              h(For, { values: sig }, item => h('div', {}, item.label)),
                              c
                          );
                          return { ctx: { sig, dispose }, toggle: false };
                      },
                      async run(state) {
                          state.toggle = !state.toggle;
                          state.ctx.sig(state.toggle ? orderB : baseItems);
                      },
                  };
              }
              return {
                  name: 'voby',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- solid-js (For component) ----
const solidKeyed =
    solid && solidWeb && solidH && solid.For
        ? (() => {
              const { createSignal, For } = solid;
              const render = solidWeb.render;
              const h = solidH.default ?? solidH;
              // Probe: solid's For can trip "Client-only API called on the server side"
              // in some DOM environments. Skip cleanly there; real Chromium passes.
              try {
                  const probe = document.createElement('div');
                  const [items] = createSignal([{ id: 0, label: 'p' }]);
                  const dispose = render(() => h(For, { each: items }, it => h('div', {}, it.label)), probe);
                  dispose?.();
              } catch (err) {
                  console.warn(`[bench] solid-js keyed scenarios skipped: ${err.message}`);
                  return null;
              }
              function build(orderB) {
                  return {
                      async: true,
                      setup() {
                          const c = makeContainer();
                          const [items, setItems] = createSignal(baseItems);
                          const dispose = render(() => h(For, { each: items }, item => h('div', {}, item.label)), c);
                          return { ctx: { setItems, dispose }, toggle: false };
                      },
                      async run(state) {
                          state.toggle = !state.toggle;
                          state.ctx.setItems(state.toggle ? orderB : baseItems);
                      },
                  };
              }
              return {
                  name: 'solid-js',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- preact (key prop) ----
const preactKeyed = preact
    ? (() => {
          const { h, render } = preact;
          const tmpl = items =>
              h(
                  'div',
                  null,
                  items.map(it => h('div', { key: it.id }, it.label))
              );
          return makeKeyedAdapter(
              'preact',
              c => {
                  render(tmpl(baseItems), c);
                  return c;
              },
              (c, items) => render(tmpl(items), c)
          );
      })()
    : null;

// ---- mithril (key attribute) ----
const mithrilKeyed = mithril
    ? (() => {
          const m = mithril.default ?? mithril;
          const tmpl = items => items.map(it => m('div', { key: it.id }, it.label));
          return makeKeyedAdapter(
              'mithril',
              c => {
                  m.render(c, tmpl(baseItems));
                  return c;
              },
              (c, items) => m.render(c, tmpl(items))
          );
      })()
    : null;

// ---- snabbdom (key in vnode data) ----
const snabbdomKeyed = snabbdom
    ? (() => {
          const { init, h, classModule, propsModule, attributesModule, eventListenersModule } = snabbdom;
          const patch = init([classModule, propsModule, attributesModule, eventListenersModule]);
          const tmpl = items =>
              h(
                  'div#root',
                  {},
                  items.map(it => h('div', { key: it.id }, it.label))
              );
          function build(orderB) {
              return {
                  setup() {
                      const c = makeContainer();
                      const slot = c.appendChild(document.createElement('div'));
                      const vnode = patch(slot, tmpl(baseItems));
                      return { ctx: { vnode }, toggle: false };
                  },
                  run(state) {
                      state.toggle = !state.toggle;
                      state.ctx.vnode = patch(state.ctx.vnode, tmpl(state.toggle ? orderB : baseItems));
                  },
              };
          }
          return {
              name: 'snabbdom',
              swapRows: build(swappedOrder),
              shuffle1000: build(shuffledOrder),
              appendTail: build(appendTailOrder),
              prependHead: build(prependHeadOrder),
              updateTail: build(updateTailOrder),
          };
      })()
    : null;

// ---- @slimlib/jsx (forEach function) ----
const slimlibForEachKeyed =
    slimlibJsx && slimlibStore && slimlibForEach
        ? (() => {
              const { createElement: h, render } = slimlibJsx;
              const { signal } = slimlibStore;
              const forEach = slimlibForEach.forEach;
              if (typeof forEach !== 'function') {
                  console.warn('[bench] @slimlib/jsx/for-each adapter disabled: missing forEach');
                  return null;
              }
              function build(orderB) {
                  return {
                      async: true,
                      setup() {
                          const c = makeContainer();
                          const items = signal(baseItems);
                          const dispose = render(
                              () =>
                                  h(
                                      'div',
                                      null,
                                      forEach(
                                          () => items(),
                                          item => item.id,
                                          item => h('div', null, () => item().label)
                                      )
                                  ),
                              c
                          );
                          drainSlimlib();
                          return { ctx: { items, dispose }, toggle: false };
                      },
                      run(state) {
                          state.toggle = !state.toggle;
                          state.ctx.items.set(state.toggle ? orderB : baseItems);
                          drainSlimlib();
                      },
                      teardown(state) {
                          state.ctx.dispose?.();
                      },
                  };
              }
              return {
                  name: '@slimlib/jsx',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- @slimlib/jsx (sync) — same keyed primitive, sync scheduler ----
const slimlibForEachKeyedSync =
    slimlibForEachKeyed && slimlibStore
        ? (() => {
              const { setScheduler } = slimlibStore;
              const defaultSched = queueMicrotask.bind(globalThis);
              const syncSched = fn => fn();
              function withSync(fn) {
                  return function (...args) {
                      setScheduler(syncSched);
                      drainSlimlib = noopDrainSlimlib;
                      const restore = () => {
                          setScheduler(defaultSched);
                          drainSlimlib = realDrainSlimlib;
                      };
                      let returnedPromise = false;
                      try {
                          const r = fn.apply(this, args);
                          if (r && typeof r.then === 'function') {
                              returnedPromise = true;
                              return r.finally(restore);
                          }
                          return r;
                      } finally {
                          if (!returnedPromise) restore();
                      }
                  };
              }
              function wrap(inner) {
                  if (!inner) return null;
                  const w = { async: true };
                  w.setup = withSync(inner.setup);
                  w.run = withSync(inner.run);
                  if (inner.teardown) w.teardown = withSync(inner.teardown);
                  return w;
              }
              return {
                  name: '@slimlib/jsx (sync)',
                  swapRows: wrap(slimlibForEachKeyed.swapRows),
                  shuffle1000: wrap(slimlibForEachKeyed.shuffle1000),
                  appendTail: wrap(slimlibForEachKeyed.appendTail),
                  prependHead: wrap(slimlibForEachKeyed.prependHead),
                  updateTail: wrap(slimlibForEachKeyed.updateTail),
              };
          })()
        : null;

// ---- react keyed (key prop on rows) ----
const reactKeyed =
    reactMod && reactDomClient && reactDom && reactAdapter
        ? (() => {
              const React = reactMod.default ?? reactMod;
              const createElement = React.createElement;
              const { createRoot } = reactDomClient;
              const { flushSync } = reactDom;
              const tmpl = items =>
                  createElement(
                      'div',
                      null,
                      items.map(it => createElement('div', { key: it.id }, it.label)),
                  );
              function build(orderB) {
                  return {
                      setup() {
                          const c = makeContainer();
                          const root = createRoot(c);
                          flushSync(() => root.render(tmpl(baseItems)));
                          return { c, root, toggle: false };
                      },
                      run(state) {
                          state.toggle = !state.toggle;
                          flushSync(() => state.root.render(tmpl(state.toggle ? orderB : baseItems)));
                      },
                      teardown(state) {
                          try {
                              state.root.unmount();
                          } catch {
                              /* ignore */
                          }
                          state.c?.remove?.();
                      },
                  };
              }
              return {
                  name: 'react',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- vue keyed (key on each row) ----
const vueKeyed =
    vueMod && vueAdapter
        ? (() => {
              const { h, createApp, shallowRef, nextTick } = vueMod;
              function build(orderB) {
                  return {
                      async: true,
                      setup() {
                          const c = makeContainer();
                          const itemsRef = shallowRef(baseItems);
                          const app = createApp({
                              setup() {
                                  return () =>
                                      h(
                                          'div',
                                          null,
                                          itemsRef.value.map(it => h('div', { key: it.id }, it.label)),
                                      );
                              },
                          });
                          app.mount(c);
                          return { c, app, itemsRef, toggle: false };
                      },
                      async run(state) {
                          state.toggle = !state.toggle;
                          state.itemsRef.value = state.toggle ? orderB : baseItems;
                          await nextTick();
                      },
                      teardown(state) {
                          try {
                              state.app.unmount();
                          } catch {
                              /* ignore */
                          }
                          state.c?.remove?.();
                      },
                  };
              }
              return {
                  name: 'vue',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

// ---- svelte keyed ({#each items as it (it.id)}) ----
const svelteKeyed =
    svelteMod && svelteKeyedMod && svelteAdapter
        ? (() => {
              const { mount, unmount, flushSync } = svelteMod;
              const KeyedList = svelteKeyedMod.default;
              function build(orderB) {
                  return {
                      setup() {
                          const c = makeContainer();
                          const instance = mount(KeyedList, { target: c, props: {} });
                          instance.setItems(baseItems);
                          flushSync();
                          return { c, instance, toggle: false };
                      },
                      run(state) {
                          state.toggle = !state.toggle;
                          state.instance.setItems(state.toggle ? orderB : baseItems);
                          flushSync();
                      },
                      teardown(state) {
                          try {
                              unmount(state.instance);
                          } catch {
                              /* ignore */
                          }
                          state.c?.remove?.();
                      },
                  };
              }
              return {
                  name: 'svelte',
                  swapRows: build(swappedOrder),
                  shuffle1000: build(shuffledOrder),
                  appendTail: build(appendTailOrder),
                  prependHead: build(prependHeadOrder),
                  updateTail: build(updateTailOrder),
              };
          })()
        : null;

const keyedAdapters = [
    uhtmlKeyed,
    lighterKeyed,
    nanoKeyed,
    litKeyed,
    vobyKeyed,
    solidKeyed,
    preactKeyed,
    mithrilKeyed,
    snabbdomKeyed,
    slimlibForEachKeyed,
    slimlibForEachKeyedSync,
    reactKeyed,
    vueKeyed,
    svelteKeyed,
].filter(Boolean);

// ----- scenario registration ---------------------------------------------

const keyedSkips = [
    ['vanjs-core', 'no keyed reconciliation primitive'],
    ['@mastrojs/reactive', 'HTML+signal model, no list reconciliation'],
];

const allAdapters = [
    uhtmlAdapter,
    lighterAdapter,
    nanoAdapter,
    mastroAdapter,
    litAdapter,
    vobyAdapter,
    vanAdapter,
    solidAdapter,
    preactAdapter,
    mithrilAdapter,
    snabbdomAdapter,
    slimlibAdapter,
    slimlibSyncAdapter,
    reactAdapter,
    vueAdapter,
    svelteAdapter,
].filter(Boolean);

// deep-tree leaf-count probe. Render each adapter's tree once into a throwaway
// container and count <span> leaves. We expect DEEP_LEAVES (4096). Anything
// off means the adapter is dropping or duplicating nodes and the numbers for
// that lib should be treated with suspicion.
for (const adapter of allAdapters) {
    const spec = adapter.deepTree;
    if (!spec || adapter.skip) continue;
    try {
        const state = spec.setup();
        const maybe = spec.run(state);
        if (maybe && typeof maybe.then === 'function') await maybe;
        const got = state.c.querySelectorAll('span').length;
        if (got !== DEEP_LEAVES) {
            console.warn(`[bench] deep-tree probe: ${adapter.name} produced ${got} leaves, expected ${DEEP_LEAVES}`);
        } else {
            console.log(`[bench] deep-tree probe: ${adapter.name} ok (${got} leaves)`);
        }
        if (typeof spec.teardown === 'function') {
            try {
                spec.teardown(state);
            } catch {
                /* ignore */
            }
        } else {
            try {
                state.dispose?.();
            } catch {
                /* ignore */
            }
            state.c?.remove?.();
        }
    } catch (err) {
        console.warn(`[bench] deep-tree probe: ${adapter.name} threw: ${err.message}`);
    }
}

// deep-tree-update probe: setup renders with label 'A'; one run() toggles to
// 'B'. Verify the tree still has 4096 leaves and the first leaf's text
// reflects the new label. Adapters that fail the probe stay in the bench but
// the warning flags numbers as suspect.
for (const adapter of allAdapters) {
    const spec = adapter.deepTreeUpdate;
    if (!spec || adapter.skip) continue;
    try {
        const state = spec.setup();
        const maybe = spec.run(state);
        if (maybe && typeof maybe.then === 'function') await maybe;
        const spans = state.c.querySelectorAll('span');
        const text = spans[0]?.textContent ?? '';
        const leavesOk = spans.length === DEEP_LEAVES;
        const labelOk = text.startsWith('B');
        if (!leavesOk || !labelOk) {
            console.warn(`[bench] deep-tree-update probe: ${adapter.name} leaves=${spans.length} firstText="${text}"`);
        } else {
            console.log(`[bench] deep-tree-update probe: ${adapter.name} ok (${spans.length} leaves, firstText="${text}")`);
        }
        if (typeof spec.teardown === 'function') {
            try {
                spec.teardown(state);
            } catch {
                /* ignore */
            }
        } else {
            try {
                state.dispose?.();
            } catch {
                /* ignore */
            }
            state.c?.remove?.();
        }
    } catch (err) {
        console.warn(`[bench] deep-tree-update probe: ${adapter.name} threw: ${err.message}`);
    }
}

// Fairness probe for Strategy B (per-setup signal) adapters: run the actual
// setup→run→teardown five times and compare the run() cost on cycle 1 vs
// cycle 5. If cycle 5 is more than 2× slower than cycle 1 the per-setup
// signal isolation is broken — most likely a subscriber leak — and the
// numbers for that lib×scenario are flagged.
const fairnessTargets = [
    ['voby', 'update-1000', vobyAdapter?.update1000],
    ['voby', 'deep-tree-update', vobyAdapter?.deepTreeUpdate],
    ['solid-js', 'deep-tree-update', solidAdapter?.deepTreeUpdate],
    ['vanjs-core', 'update-1000', vanAdapter?.update1000],
    ['vanjs-core', 'deep-tree-update', vanAdapter?.deepTreeUpdate],
];
for (const [libName, scenario, spec] of fairnessTargets) {
    if (!spec) {
        console.warn(`[fairness] ${libName} ${scenario} skipped (spec unavailable)`);
        continue;
    }
    try {
        const samples = new Array(5);
        for (let cycle = 0; cycle < 5; cycle++) {
            const state = spec.setup();
            const t0 = performance.now();
            const maybe = spec.run(state);
            if (maybe && typeof maybe.then === 'function') await maybe;
            const t1 = performance.now();
            samples[cycle] = t1 - t0;
            if (typeof spec.teardown === 'function') {
                try {
                    spec.teardown(state);
                } catch {
                    /* ignore */
                }
            } else {
                try {
                    state.dispose?.();
                } catch {
                    /* ignore */
                }
                state.c?.remove?.();
            }
        }
        const c1 = samples[0];
        const c5 = samples[4];
        const ratio = c5 / c1;
        const fmt = ms => `${(ms * 1000).toFixed(1)}µs`;
        if (ratio > 2) {
            console.warn(`[fairness] FAIL ${libName} ${scenario}: cycle5/cycle1 = ${ratio.toFixed(2)}x (${fmt(c1)} → ${fmt(c5)})`);
        } else {
            console.log(
                `[fairness] ${libName} ${scenario} stable across 5 cycles (cycle1 vs cycle5: ${fmt(c1)} / ${fmt(c5)}, ratio=${ratio.toFixed(2)}x)`
            );
        }
    } catch (err) {
        console.warn(`[fairness] ${libName} ${scenario} threw: ${err.message}`);
    }
}

const scenarios = [
    ['create-1000', allAdapters.map(a => ({ adapter: a, spec: a.create1000 }))],
    ['update-1000', allAdapters.map(a => ({ adapter: a, spec: a.update1000 }))],
    ['custom-element-mount', allAdapters.map(a => ({ adapter: a, spec: a.customElement }))],
    ['deep-tree', allAdapters.map(a => ({ adapter: a, spec: a.deepTree }))],
    ['deep-tree-update', allAdapters.map(a => ({ adapter: a, spec: a.deepTreeUpdate }))],
];

// ---- unified DOM-commit smoke test (replaces per-lib startup probes) ----
// For each adapter that exposes an `update1000` spec we set up, dispatch
// the first run, drain via the scheduler probe, and assert that *something*
// changed. Failures are warnings — they signal probe.drain() didn't catch
// the lib's scheduler and its numbers may be unfair.
probe.arm();
try {
    for (const adapter of allAdapters) {
        const spec = adapter.update1000;
        if (!spec || adapter.skip) continue;
        try {
            const state = spec.setup();
            await probe.drain();
            const before = state.c?.innerHTML ?? '';
            const r = spec.run(state);
            if (r && typeof r.then === 'function') await r;
            await probe.drain();
            const after = state.c?.innerHTML ?? '';
            const ok = before !== after && after.length > 0;
            console.log(`[probe] ${adapter.name.padEnd(22)} update-1000 commit: ${ok ? 'ok ' : 'FAIL'}  (Δlen=${after.length - before.length})`);
            if (!ok) console.warn(`[probe] ${adapter.name}: probe.drain() did not produce a visible commit; numbers may be unreliable`);
            if (typeof spec.teardown === 'function') {
                try { spec.teardown(state); } catch { /* ignore */ }
            } else {
                try { state.dispose?.(); } catch { /* ignore */ }
                state.c?.remove?.();
            }
        } catch (err) {
            console.warn(`[probe] ${adapter.name} update-1000 smoke failed: ${err.message}`);
        }
    }
} finally {
    probe.disarm();
}

// Arm the scheduler probe for the duration of the bench. Every timed body
// runs the adapter's `spec.run()` and then awaits `probe.drain()`, so we
// uniformly include the cost of any scheduled microtask / rAF / setTimeout(0)
// work in the measurement. We also snapshot per-(scenario, lib) call counts
// on the first armed run as a fairness fingerprint, emitted alongside the CSV.
probe.arm();

function makeBenchBody(adapter, scenarioName, spec) {
    const key = `${scenarioName}:${adapter.name}`;
    let fingerprinted = false;
    return function* () {
        const state = spec.setup();
        // Drain any work scheduled during setup so it doesn't bleed into the
        // first iteration's fingerprint. Generator-context — sync drain only.
        try {
            probe.drainSync();
        } catch {
            /* ignore */
        }
        // Sync warmup (we're inside a generator). The first yielded iteration
        // also drains async-style and captures the fingerprint.
        for (let i = 0; i < 2; i++) {
            try {
                spec.run(state);
                probe.drainSync();
            } catch {
                /* ignore warmup errors */
            }
        }
        yield async () => {
            if (!fingerprinted) probe.resetCounts();
            const r = spec.run(state);
            if (r && typeof r.then === 'function') await r;
            await probe.drain();
            if (!fingerprinted) {
                fingerprint[key] = probe.counts();
                fingerprinted = true;
            }
        };
    };
}

for (const [scenarioName, entries] of scenarios) {
    group(scenarioName, () => {
        summary(() => {
            for (const { adapter, spec } of entries) {
                if (!spec) {
                    console.warn(`[bench] ${adapter.name} skips ${scenarioName} (not applicable)`);
                    continue;
                }
                if (adapter.skip) {
                    console.warn(`[bench] ${adapter.name} skips ${scenarioName}: ${adapter.skipReason}`);
                    continue;
                }
                bench(adapter.name, makeBenchBody(adapter, scenarioName, spec)).gc('inner');
            }
        });
    });
}

for (const scenarioName of ['swap-rows', 'shuffle-1000', 'append-tail-1000', 'prepend-head-1000', 'update-tail-1000']) {
    group(scenarioName, () => {
        summary(() => {
            for (const adapter of keyedAdapters) {
                const spec =
                    scenarioName === 'swap-rows' ? adapter.swapRows :
                    scenarioName === 'shuffle-1000' ? adapter.shuffle1000 :
                    scenarioName === 'append-tail-1000' ? adapter.appendTail :
                    scenarioName === 'prepend-head-1000' ? adapter.prependHead :
                    adapter.updateTail;
                if (!spec) continue;
                bench(adapter.name, makeBenchBody(adapter, scenarioName, spec)).gc('inner');
            }
            for (const [name, reason] of keyedSkips) {
                console.warn(`[bench] ${name} skips ${scenarioName}: ${reason}`);
            }
        });
    });
}

const runResult = await run();
probe.disarm();

// ---- Scheduler probe fingerprint (per scenario × lib call counts) -------
console.log('[probe] scheduler call fingerprint (first armed run of each lib×scenario):');
for (const scenarioName of ['create-1000', 'update-1000', 'custom-element-mount', 'deep-tree', 'deep-tree-update', 'swap-rows', 'shuffle-1000', 'append-tail-1000', 'prepend-head-1000', 'update-tail-1000']) {
    for (const adapter of allAdapters) {
        const key = `${scenarioName}:${adapter.name}`;
        const c = fingerprint[key];
        if (!c) continue;
        console.log(`[probe] ${scenarioName.padEnd(22)} ${adapter.name.padEnd(22)} microtask=${c.microtask} raf=${c.raf} timeout0=${c.timeout0}`);
    }
}

// ---- CSV emission --------------------------------------------------------
// mitata returns { context, benchmarks, layout }. Each entry in `benchmarks`
// is a trial with { alias, group, runs: [{ stats }] }; `layout[group].name`
// is the scenario group label. `stats.samples` and `stats.avg` are in
// nanoseconds — we convert to milliseconds to match store/results.csv.

const scenarioOrder = ['create-1000', 'update-1000', 'custom-element-mount', 'deep-tree', 'deep-tree-update', 'swap-rows', 'shuffle-1000', 'append-tail-1000', 'prepend-head-1000', 'update-tail-1000'];
const libOrder = allAdapters.map(a => a.name);

// scenario -> lib -> { mean, variance, n } (all in ms / ms²)
const table = new Map();
for (const trial of runResult.benchmarks) {
    const scenario = runResult.layout?.[trial.group]?.name;
    if (!scenario) continue;
    const run0 = trial.runs?.[0];
    const stats = run0?.stats;
    if (!stats || !Array.isArray(stats.samples) || stats.samples.length === 0) continue;
    const samplesMs = stats.samples.map(ns => ns / 1e6);
    const n = samplesMs.length;
    const mean = samplesMs.reduce((s, x) => s + x, 0) / n;
    let varSum = 0;
    for (const x of samplesMs) varSum += (x - mean) * (x - mean);
    const variance = varSum / n;
    if (!table.has(scenario)) table.set(scenario, new Map());
    table.get(scenario).set(trial.alias, { mean, variance, n });
}

const fmt = x => x.toFixed(4);
const headerCols = ['test'];
for (const lib of libOrder) {
    headerCols.push(`${lib}_mean`, `${lib}_variance`, `${lib}_n`);
}
const rows = [headerCols.join(',')];
let scenarioCount = 0;
for (const scenario of scenarioOrder) {
    const byLib = table.get(scenario);
    if (!byLib) continue;
    scenarioCount++;
    const cells = [scenario];
    for (const lib of libOrder) {
        const r = byLib.get(lib);
        if (!r) {
            cells.push('', '', '');
            continue;
        }
        cells.push(fmt(r.mean), fmt(r.variance), String(r.n));
    }
    rows.push(cells.join(','));
}
const csv = rows.join('\n') + '\n';

console.log(`[bench-results] ${JSON.stringify({ scenarioOrder, libOrder, csv, scenarioCount })}`);

console.log('[bench-done]');
