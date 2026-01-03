import getParameterNames from '@slimlib/get-parameter-names';

/**
 * @typedef {(key: string, value: unknown) => void} Provider
 */

/**
 * @returns {<F extends (...args: any[]) => any>(func: F, scope?: object) => ReturnType<F>}
 */
export default function () {
    /** @type {Record<string, unknown>} */
    const dependencies = Object.create(null);

    dependencies.$provide = /** @type {Provider} */ (
        (key, value) => {
            dependencies[key] = value;
        }
    );

    return (func, scope = {}) =>
        func.apply(
            scope,
            getParameterNames(func).map((/** @type {string} */ key) => dependencies[key])
        );
}
