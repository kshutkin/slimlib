import { render } from '@slimlib/jsx';
import { forEach } from '@slimlib/jsx/for-each';
import { computed, effect, setScheduler, signal } from '@slimlib/store';

// Counter — signals + on:click + reactive text
const Counter = () => {
    const count = signal(0);
    return (
        <div class='row'>
            <button type='button' on:click={() => count.set(count() - 1)}>
                −
            </button>
            <output>{count}</output>
            <button type='button' on:click={() => count.set(count() + 1)}>
                +
            </button>
            <button type='button' on:click={() => count.set(0)}>
                reset
            </button>
        </div>
    );
};

// Conditional render — proves sub-scope cleanup
// (on:click handlers and effects inside each branch are disposed when the branch swaps)
const Toggle = () => {
    const open = signal(false);
    return (
        <div>
            <button type='button' on:click={() => open.set(!open())}>
                {() => (open() ? 'Hide details' : 'Show details')}
            </button>
            <div>
                {() =>
                    open() ? (
                        <p>
                            Hidden text. Open the devtools and watch the DOM swap — the previous branch's effects,
                            <code> on:</code>-listeners and <code>ref</code> callbacks are torn down before this one mounts.
                        </p>
                    ) : null
                }
            </div>
        </div>
    );
};

// Reactive text input — signal driven from input event
const Greeter = () => {
    const name = signal('world');
    const upper = computed(() => name().toUpperCase());
    return (
        <div class='row'>
            <input type='text' value={name} on:input={e => name.set(e.currentTarget.value)} />
            <span>
                Hello, <strong>{name}</strong>! ({upper})
            </span>
        </div>
    );
};

// Keyed list via forEach — add / remove / toggle / shuffle
let nextId = 4;
const TodoList = () => {
    const items = signal([
        { id: 1, text: 'Write tests', done: true },
        { id: 2, text: 'Ship forEach', done: true },
        { id: 3, text: 'Build playground', done: false },
    ]);
    const draft = signal('');
    const add = () => {
        const text = draft().trim();
        if (!text) return;
        items.set([...items(), { id: nextId++, text, done: false }]);
        draft.set('');
    };
    const toggle = id => items.set(items().map(it => (it.id === id ? { ...it, done: !it.done } : it)));
    const remove = id => items.set(items().filter(it => it.id !== id));
    const shuffle = () =>
        items.set(
            items()
                .map(it => [Math.random(), it])
                .sort((a, b) => a[0] - b[0])
                .map(([, it]) => it)
        );
    return (
        <div>
            <div class='row'>
                <input
                    type='text'
                    value={draft}
                    on:input={e => draft.set(e.currentTarget.value)}
                    on:keydown={e => e.key === 'Enter' && add()}
                    placeholder='New item…'
                />
                <button type='button' on:click={add}>
                    add
                </button>
                <button type='button' on:click={shuffle}>
                    shuffle
                </button>
            </div>
            <ul class='todo'>
                {forEach(
                    items,
                    it => it.id,
                    it => (
                        <li class={() => (it().done ? 'done' : '')}>
                            <input type='checkbox' checked={() => it().done} on:change={() => toggle(it().id)} />
                            <span>{() => it().text}</span>
                            <button type='button' on:click={() => remove(it().id)}>
                                ×
                            </button>
                        </li>
                    )
                )}
            </ul>
            <p>
                <small>
                    {() => items().filter(it => !it.done).length} open / {() => items().length} total
                </small>
            </p>
        </div>
    );
};

// Scheduler bench — burst writes + steady-state animation.
// Open DevTools → Performance, click Record, hit the buttons, stop, and inspect
// scripting / rendering bands for each scheduler.
const SCHEDULERS = {
    microtask: queueMicrotask,
    raf: cb => requestAnimationFrame(cb),
    sync: cb => cb(),
};
// Module-level so other panels (RowsBench) can read the active mode for
// accurate end-of-flush timing. setScheduler is global anyway.
const schedulerMode = signal('microtask');
const pickScheduler = m => {
    schedulerMode.set(m);
    setScheduler(SCHEDULERS[m]);
};
pickScheduler('microtask');
const CELLS = 5000;
const BOXES = 200;

// Cascading tree — each level derived from the previous level via signals + effects.
// Bump the root and every level recomputes; under the microtask scheduler each
// level's writes are flushed in their own microtask, so the cascade unfolds as
// a chain of microtasks (one per level) inside the same task.
const CASCADE_DEPTH = 6;     // 6 levels under root => 7 rows
const CASCADE_BRANCHING = 2; // binary tree

const CascadingTree = () => {
    const root = signal(0);
    const levels = [[root]];
    for (let lvl = 1; lvl <= CASCADE_DEPTH; lvl++) {
        const prev = levels[lvl - 1];
        const cur = [];
        for (let i = 0; i < prev.length; i++) {
            const parent = prev[i];
            for (let b = 0; b < CASCADE_BRANCHING; b++) {
                const child = signal(0);
                const branchIdx = b;
                effect(() => child.set(parent() * CASCADE_BRANCHING + branchIdx + 1));
                cur.push(child);
            }
        }
        levels.push(cur);
    }
    const bump = () => root.set(root() + 1);
    const reset = () => root.set(0);
    const totalNodes = levels.reduce((s, l) => s + l.length, 0);
    return (
        <div>
            <div class='row'>
                <button type='button' on:click={bump}>bump root</button>
                <button type='button' on:click={reset}>reset</button>
                <small>
                    {CASCADE_DEPTH + 1} levels, {totalNodes} nodes. Each level is written by an effect
                    that reads its parent — bumping the root cascades down via the scheduler.
                </small>
            </div>
            <div class='cascade'>
                {levels.map(level => (
                    <div class='cascade-level'>
                        {level.map(sig => <span class='cascade-node'>{sig}</span>)}
                    </div>
                ))}
            </div>
        </div>
    );
};

const SchedulerBench = () => {
    const mode = schedulerMode;
    const pick = pickScheduler;

    // --- Burst panel ---
    const mounted = signal(false);
    const cells = Array.from({ length: CELLS }, () => signal(0));
    const lastBurst = signal('—');
    const runBurst = (label, fn) => {
        const t0 = performance.now();
        fn();
        const dt = (performance.now() - t0).toFixed(2);
        lastBurst.set(`${label}: ${dt} ms (sync portion)`);
    };
    const tick1 = () => runBurst('tick ×1', () => {
        for (let i = 0; i < CELLS; i++) cells[i].set(cells[i]() + 1);
    });
    const tick10 = () => runBurst('tick ×10', () => {
        for (let r = 0; r < 10; r++) for (let i = 0; i < CELLS; i++) cells[i].set(cells[i]() + 1);
    });

    // --- Animation panel ---
    const boxes = Array.from({ length: BOXES }, (_, i) => ({
        x: signal(0),
        y: signal(0),
        s: i,
    }));
    const fps = signal(0);
    let driver = null; // 'raf' | 'interval' | null
    let rafId = 0;
    let intervalId = 0;
    let frames = 0;
    let lastFpsT = 0;
    const tickFrame = t => {
        for (let i = 0; i < BOXES; i++) {
            const b = boxes[i];
            b.x.set(200 + 180 * Math.sin(t / 600 + b.s * 0.1));
            b.y.set(100 + 80 * Math.cos(t / 500 + b.s * 0.13));
        }
        frames++;
        if (t - lastFpsT > 500) {
            fps.set(Math.round((frames * 1000) / (t - lastFpsT)));
            frames = 0;
            lastFpsT = t;
        }
    };
    const startRaf = () => {
        if (driver) return;
        driver = 'raf';
        lastFpsT = performance.now();
        const loop = t => {
            if (driver !== 'raf') return;
            tickFrame(t);
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
    };
    const startInterval = () => {
        if (driver) return;
        driver = 'interval';
        lastFpsT = performance.now();
        intervalId = setInterval(() => tickFrame(performance.now()), 0);
    };
    const stop = () => {
        driver = null;
        cancelAnimationFrame(rafId);
        clearInterval(intervalId);
        fps.set(0);
    };

    return (
        <div>
            <div class='row'>
                <strong>scheduler:</strong>
                {['microtask', 'raf', 'sync'].map(m => (
                    <label class='row'>
                        <input
                            type='radio'
                            name='sched'
                            checked={() => mode() === m}
                            on:change={() => pick(m)}
                        />
                        {m}
                    </label>
                ))}
                <small>
                    microtask = default (queueMicrotask), raf = requestAnimationFrame, sync = inline flush.
                </small>
            </div>

            <h3>Burst writes ({CELLS} reactive cells)</h3>
            <p>
                <small>
                    Each cell is its own signal + reactive text node. <code>tick ×1</code> issues one
                    <code> set()</code> per cell; <code>tick ×10</code> issues ten. With microtask/raf the
                    repeats collapse into one flush per effect; with sync each <code>set()</code> re-runs
                    the effect immediately.
                </small>
            </p>
            <div class='row'>
                {() =>
                    mounted()
                        ? (
                            <button type='button' on:click={() => mounted.set(false)}>
                                unmount {CELLS} cells
                            </button>
                        )
                        : (
                            <button type='button' on:click={() => mounted.set(true)}>
                                mount {CELLS} cells
                            </button>
                        )
                }
                <button type='button' on:click={tick1}>tick ×1</button>
                <button type='button' on:click={tick10}>tick ×10</button>
                <small>{lastBurst}</small>
            </div>
            <div class='cells'>
                {() =>
                    mounted()
                        ? cells.map(c => <div class='cell'>{c}</div>)
                        : null
                }
            </div>

            <h3>Animation ({BOXES} boxes, steady-state)</h3>
            <p>
                <small>
                    The <em>driver</em> chooses how often <code>set()</code> fires. The <em>scheduler</em>
                    chooses when DOM writes flush. Try every combination — sync + setInterval is the
                    worst case (synchronous reflow per box per tick); raf + raf is the smoothest.
                </small>
            </p>
            <div class='row'>
                <button type='button' on:click={startRaf}>start (rAF driver)</button>
                <button type='button' on:click={startInterval}>start (setInterval 0)</button>
                <button type='button' on:click={stop}>stop</button>
                <span>fps: <strong>{fps}</strong></span>
            </div>
            <div class='stage'>
                {boxes.map(b => (
                    <div
                        class='box'
                        attr:style={() => `transform: translate(${b.x()}px, ${b.y()}px)`}
                    />
                ))}
            </div>
        </div>
    );
};

// Rows bench — mirrors swap-rows / shuffle / update scenarios from the
// js-framework-benchmark suite the browser bench uses. Each cell label is a
// signal so updates re-run only the inner text effect (no row remount).
const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const COLOR = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const NOUN = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];
const pick = arr => arr[(Math.random() * arr.length) | 0];
let rowId = 1;
const makeRows = n => {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = { id: rowId++, label: signal(`${pick(ADJ)} ${pick(COLOR)} ${pick(NOUN)}`) };
    }
    return out;
};

const RowsBench = () => {
    const rows = signal([]);
    const selected = signal(-1);
    const last = signal('—');
    const measure = (label, fn) => {
        const t0 = performance.now();
        fn();
        // End the measurement on the SAME scheduler the store is using, so dt
        // includes the flush regardless of mode (microtask flushes before any
        // rAF; rAF flush only fires on next frame).
        const end = () => {
            const dt = (performance.now() - t0).toFixed(2);
            last.set(`${label}: ${dt} ms (${schedulerMode()})`);
        };
        const mode = schedulerMode();
        if (mode === 'sync') end();
        else if (mode === 'raf') requestAnimationFrame(() => queueMicrotask(end));
        else queueMicrotask(end);
    };
    const create = n => measure(`create ${n}`, () => { rowId = 1; rows.set(makeRows(n)); });
    const append = n => measure(`append ${n}`, () => rows.set(rows().concat(makeRows(n))));
    const updateEvery10th = () => measure('update every 10th', () => {
        const r = rows();
        for (let i = 0; i < r.length; i += 10) r[i].label.set(`${r[i].label()} !!!`);
    });
    const swap = () => measure('swap rows 1 / 998', () => {
        const r = rows();
        if (r.length < 999) return;
        const next = r.slice();
        const a = next[1];
        next[1] = next[998];
        next[998] = a;
        rows.set(next);
    });
    const shuffle = () => measure('shuffle', () => {
        const r = rows().slice();
        for (let i = r.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            const t = r[i]; r[i] = r[j]; r[j] = t;
        }
        rows.set(r);
    });
    const clear = () => measure('clear', () => rows.set([]));
    return (
        <div>
            <p>
                <small>
                    1000-row keyed table via <code>forEach</code>. Each label is its own signal — updates
                    re-run a single text effect per row. Swap / shuffle trigger key-based reordering only;
                    rows are not recreated.
                </small>
            </p>
            <div class='row'>
                <button type='button' on:click={() => create(1000)}>create 1 000</button>
                <button type='button' on:click={() => create(10000)}>create 10 000</button>
                <button type='button' on:click={() => append(1000)}>append 1 000</button>
                <button type='button' on:click={updateEvery10th}>update every 10th</button>
                <button type='button' on:click={swap}>swap rows</button>
                <button type='button' on:click={shuffle}>shuffle</button>
                <button type='button' on:click={clear}>clear</button>
                <small>{last}</small>
            </div>
            <div class='rows-wrap'>
                <table class='rows'>
                    <tbody>
                        {forEach(
                            rows,
                            r => r.id,
                            r => (
                                <tr class={() => (selected() === r().id ? 'selected' : '')}>
                                    <td>{() => r().id}</td>
                                    <td>
                                        <a on:click={() => selected.set(r().id)}>{() => r().label()}</a>
                                    </td>
                                    <td>
                                        <a on:click={() => rows.set(rows().filter(x => x.id !== r().id))}>×</a>
                                    </td>
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const App = () => (
    <>
        <h1>@slimlib/jsx playground</h1>
        <p>
            Edit <code>main.jsx</code> and refresh — esbuild rebuilds on request. JSX is compiled with{' '}
            <code>jsxImportSource: "@slimlib/jsx"</code>.
        </p>
        <section class='demo'>
            <h2>Counter (signal + on:click)</h2>
            <Counter />
        </section>
        <section class='demo'>
            <h2>Conditional (sub-scope cleanup)</h2>
            <Toggle />
        </section>
        <section class='demo'>
            <h2>Reactive text + computed</h2>
            <Greeter />
        </section>
        <section class='demo'>
            <h2>Keyed list (forEach)</h2>
            <TodoList />
        </section>
        <section class='demo'>
            <h2>Cascading tree (signals + effects)</h2>
            <CascadingTree />
        </section>
        <section class='demo'>
            <h2>Scheduler bench (microtask vs rAF vs sync)</h2>
            <SchedulerBench />
        </section>
        <section class='demo'>
            <h2>Rows bench (swap / shuffle / update)</h2>
            <RowsBench />
        </section>
    </>
);

render(() => <App />, document.getElementById('app'));
