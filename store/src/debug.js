import { DEV } from 'esm-env';

import { FLAG_EFFECT } from './flags.js';
import { currentComputing } from './globals.js';
import { flagsSymbol } from './symbols.js';

/**
 * Debug configuration flag: Warn when writing to signals/state inside a computed
 * @type {number}
 */
export const WARN_ON_WRITE_IN_COMPUTED = 1 << 0;

/**
 * Debug configuration flag: Suppress warning when effects are disposed by GC instead of explicitly
 * @type {number}
 */
export const SUPPRESS_EFFECT_GC_WARNING = 1 << 1;

/**
 * Current debug configuration bitfield
 * @type {number}
 */
let debugConfigFlags = 0;

/**
 * Configure debug behavior using a bitfield of flags
 * @param {number} flags - Bitfield of debug flags (e.g., WARN_ON_WRITE_IN_COMPUTED)
 * @returns {void}
 */
export const debugConfig = flags => {
    debugConfigFlags = flags | 0;
};

/**
 * Safely call each function in an iterable, logging any errors to console
 * @param {Iterable<() => void>} fns
 */
export const safeForEach = fns => {
    for (const fn of fns) {
        try {
            fn();
        } catch (e) {
            console.error(e);
        }
    }
};

/**
 * Warn if writing inside a computed (not an effect)
 * Only runs in DEV mode and when configured
 * @param {string} context - Description of where the write is happening
 */
export const warnIfWriteInComputed = context => {
    if (DEV && debugConfigFlags & WARN_ON_WRITE_IN_COMPUTED && currentComputing && !(currentComputing[flagsSymbol] & FLAG_EFFECT)) {
        console.warn(
            `[@slimlib/store] Writing to ${context} inside a computed is not recommended. ` +
                `The computed will not automatically re-run when this value changes, which may lead to stale values.`
        );
    }
};

/**
 * FinalizationRegistry for detecting effects that are GC'd without being properly disposed.
 * Only created in DEV mode.
 * @type {FinalizationRegistry<string> | null}
 */
const effectRegistry = DEV
    ? new FinalizationRegistry(
          /** @param {string} stackTrace */ stackTrace => {
              if (!(debugConfigFlags & SUPPRESS_EFFECT_GC_WARNING)) {
                  console.warn(
                      `[@slimlib/store] Effect was garbage collected without being disposed. ` +
                          `This may indicate a memory leak. Effects should be disposed by calling the returned dispose function ` +
                          `or by using a scope that is properly disposed.\n\nEffect was created at:\n${stackTrace}`
                  );
              }
          }
      )
    : null;

/**
 * Register an effect for GC tracking.
 * Returns a token that must be passed to unregisterEffect when the effect is properly disposed.
 * Only active in DEV mode; returns undefined in production.
 * @returns {object | undefined} Registration token (only in DEV mode)
 */
export const registerEffect = DEV
    ? () => {
          const token = {};
          // Capture stack trace at effect creation for better debugging
          const stack = new Error().stack || '';
          // Remove the first two lines (Error + registerEffect call) to get to the actual effect() call
          const stackLines = stack.split('\n');
          const relevantStack = stackLines.slice(3).join('\n');
          effectRegistry?.register(token, relevantStack, token);
          return token;
      }
    : () => undefined;

/**
 * Unregister an effect from GC tracking (called when effect is properly disposed).
 * Only active in DEV mode.
 * @param {object | undefined} token - The token returned by registerEffect
 */
export const unregisterEffect = DEV
    ? /** @param {object | undefined} token */ token => {
          if (token) {
              effectRegistry?.unregister(token);
          }
      }
    : () => {};
