import { getParameterNames } from '@slimlib/get-parameter-names';

/**
 * @typedef {(key: string, value: unknown) => void} Provider
 */

/**
 * @typedef {[...string[], (...args: any[]) => any]} AnnotatedFunction
 */

/**
 * @returns {<F extends (...args: any[]) => any>(func: F, scope?: object) => ReturnType<F>}
 */
export function createInject() {
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

/**
 * Creates an injector that uses AngularJS-style array annotation for minification safety.
 * Instead of parsing parameter names, it expects dependencies to be specified as strings
 * in an array before the function: ['dep1', 'dep2', function(dep1, dep2) { ... }]
 * @returns {<F extends (...args: any[]) => any>(funcOrArray: F | [...string[], F], scope?: object) => ReturnType<F>}
 */
export function createInjectAnnotated() {
    /** @type {Record<string, unknown>} */
    const dependencies = Object.create(null);

    dependencies.$provide = /** @type {Provider} */ (
        (key, value) => {
            dependencies[key] = value;
        }
    );

    return (funcOrArray, scope = {}) => {
        if (Array.isArray(funcOrArray)) {
            const func = /** @type {(...args: any[]) => any} */ (funcOrArray.pop());
            return func.apply(
                scope,
                /** @type {string[]} */ (funcOrArray).map(key => dependencies[key])
            );
        }
        // If not an array, just call the function with no dependencies
        return funcOrArray.apply(scope, []);
    };
}
