import { setTracked, tracked } from './globals.js';

/**
 * Execute without tracking dependencies
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
export const untracked = callback => {
    const prevTracked = tracked;
    setTracked(false);
    try {
        return callback();
    } finally {
        setTracked(prevTracked);
    }
};
