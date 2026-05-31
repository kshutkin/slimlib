// @ts-nocheck
/**
 * Scheduler probe.
 *
 * While *armed*, intercepts the common browser scheduling primitives so that
 * deferred work goes into local queues instead of running asynchronously.
 * Adapters then call `drain()` inside their timed body, which flushes the
 * queues to quiescence — making per-run measurements include the DOM commit
 * regardless of whether the lib uses microtask / rAF / setTimeout(0).
 *
 * What's intercepted:
 *   - globalThis.queueMicrotask        → microtaskQueue
 *   - globalThis.requestAnimationFrame → rafQueue (cancelAnimationFrame
 *     is patched to filter the queue)
 *   - globalThis.setTimeout            → timeout0Queue when delay <= 0 / undefined,
 *     forwarded to the original otherwise (clearTimeout filters)
 *
 * NOT intercepted:
 *   - Promise.resolve().then(cb)  — patching native Promise breaks everything
 *     downstream (including mitata's own awaits). Adapters that rely on this
 *     path settle via the trailing `await Promise.resolve()` in drain().
 *   - MessageChannel               — not used by any current adapter.
 *   - setInterval                  — not a batching primitive.
 *
 * Counters track how many calls each kind received between arm() and disarm(),
 * giving a per-scenario breakdown of how each lib defers work.
 */

const STATE = {
    armed: false,
    microtask: [],
    raf: [],
    timeout0: [],
    counts: { microtask: 0, raf: 0, timeout0: 0 },
    original: null,
    rafId: 0,
    timeoutId: 0,
};

export function arm() {
    if (STATE.armed) throw new Error('scheduler-probe: already armed');
    STATE.armed = true;
    STATE.microtask.length = 0;
    STATE.raf.length = 0;
    STATE.timeout0.length = 0;
    STATE.counts.microtask = 0;
    STATE.counts.raf = 0;
    STATE.counts.timeout0 = 0;

    STATE.original = {
        queueMicrotask: globalThis.queueMicrotask,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        cancelAnimationFrame: globalThis.cancelAnimationFrame,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
    };

    globalThis.queueMicrotask = cb => {
        STATE.counts.microtask++;
        STATE.microtask.push(cb);
    };
    globalThis.requestAnimationFrame = cb => {
        STATE.counts.raf++;
        const id = ++STATE.rafId;
        STATE.raf.push({ id, cb });
        return id;
    };
    globalThis.cancelAnimationFrame = id => {
        const idx = STATE.raf.findIndex(e => e.id === id);
        if (idx >= 0) STATE.raf.splice(idx, 1);
    };
    globalThis.setTimeout = (cb, delay, ...args) => {
        if (delay == null || delay <= 0) {
            STATE.counts.timeout0++;
            const id = -++STATE.timeoutId;
            STATE.timeout0.push({ id, cb, args });
            return id;
        }
        return STATE.original.setTimeout.call(globalThis, cb, delay, ...args);
    };
    globalThis.clearTimeout = id => {
        if (id < 0) {
            const idx = STATE.timeout0.findIndex(e => e.id === id);
            if (idx >= 0) STATE.timeout0.splice(idx, 1);
            return;
        }
        STATE.original.clearTimeout.call(globalThis, id);
    };
}

/**
 * Flush all intercepted queues AND any chained `Promise.then` continuations
 * to quiescence.
 *
 * Why this is more than a single Promise checkpoint: native `await` uses the
 * engine's internal promise reaction path which bypasses user-patched
 * `Promise.prototype.then`. So we can't intercept Promise.then chains — we
 * can only observe them indirectly. We do that two ways:
 *
 *   1. After flushing the intercepted queues, keep awaiting `Promise.resolve()`
 *      one tick at a time. Each await yields one microtask checkpoint, which
 *      lets one link of any `Promise.then(...).then(...)` chain run.
 *   2. A MutationObserver on document.body fires (asynchronously, on a
 *      microtask) whenever a DOM commit happens. If a tick sees a mutation
 *      or schedules a new intercepted primitive, we reset and keep going.
 *
 * Quiescence = two consecutive idle ticks with no DOM mutation and no new
 * intercepted call. This is what makes the bench fair for libs like solid-js
 * that commit via chained `Promise.resolve().then(...)`.
 */
export async function drain() {
    if (!STATE.armed) throw new Error('scheduler-probe: not armed');
    const hasMO = typeof MutationObserver !== 'undefined' && typeof document !== 'undefined';
    let dirty = false;
    const mo = hasMO
        ? new MutationObserver(() => {
              dirty = true;
          })
        : null;
    if (mo) mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

    let iter = 0;
    const MAX = 200;
    const QUIET_TARGET = 2;
    try {
        let quiet = 0;
        while (quiet < QUIET_TARGET) {
            if (++iter > MAX) {
                throw new Error(
                    `scheduler-probe: drain did not quiesce after ${MAX} iterations ` +
                        `(microtask=${STATE.microtask.length} raf=${STATE.raf.length} timeout0=${STATE.timeout0.length} dirty=${dirty})`
                );
            }
            // Drain intercepted queues first.
            if (STATE.microtask.length || STATE.raf.length || STATE.timeout0.length) {
                if (STATE.microtask.length) {
                    const batch = STATE.microtask.splice(0);
                    for (const cb of batch) cb();
                }
                if (STATE.raf.length) {
                    const batch = STATE.raf.splice(0);
                    const ts = performance.now();
                    for (const { cb } of batch) cb(ts);
                }
                if (STATE.timeout0.length) {
                    const batch = STATE.timeout0.splice(0);
                    for (const { cb, args } of batch) cb(...args);
                }
                quiet = 0;
                continue;
            }
            // Intercepted queues are empty — let any native Promise.then
            // continuations run for one microtask checkpoint, then re-check.
            await Promise.resolve();
            if (mo) {
                // Force the MO microtask to run before we sample `dirty`.
                await Promise.resolve();
            }
            if (dirty || STATE.microtask.length || STATE.raf.length || STATE.timeout0.length) {
                dirty = false;
                quiet = 0;
            } else {
                quiet++;
            }
        }
    } finally {
        if (mo) mo.disconnect();
    }
}

// Synchronous drain — no Promise checkpoint. Use from generator-bench setup
// blocks where `await` is illegal. Flushes intercepted primitives only.
export function drainSync() {
    if (!STATE.armed) throw new Error('scheduler-probe: not armed');
    let iter = 0;
    const MAX = 100;
    while (STATE.microtask.length || STATE.raf.length || STATE.timeout0.length) {
        if (++iter > MAX) throw new Error('scheduler-probe: drainSync did not quiesce');
        if (STATE.microtask.length) {
            const batch = STATE.microtask.splice(0);
            for (const cb of batch) cb();
        }
        if (STATE.raf.length) {
            const batch = STATE.raf.splice(0);
            const ts = performance.now();
            for (const { cb } of batch) cb(ts);
        }
        if (STATE.timeout0.length) {
            const batch = STATE.timeout0.splice(0);
            for (const { cb, args } of batch) cb(...args);
        }
    }
}

export function disarm() {
    if (!STATE.armed) return { microtask: 0, raf: 0, timeout0: 0 };
    globalThis.queueMicrotask = STATE.original.queueMicrotask;
    globalThis.requestAnimationFrame = STATE.original.requestAnimationFrame;
    globalThis.cancelAnimationFrame = STATE.original.cancelAnimationFrame;
    globalThis.setTimeout = STATE.original.setTimeout;
    globalThis.clearTimeout = STATE.original.clearTimeout;
    STATE.armed = false;
    return { ...STATE.counts };
}

/** Snapshot counters without disarming. Used between drain() and disarm(). */
export function counts() {
    return { ...STATE.counts };
}

/** Reset counters without flushing. Used to measure a single run after warmup. */
export function resetCounts() {
    STATE.counts.microtask = 0;
    STATE.counts.raf = 0;
    STATE.counts.timeout0 = 0;
}
