/**
 * @enum {number}
 */
export const MockDataSource = /** @type {const} */ ({
    root: 0,
    get: 1,
    call: 2,
    set: 3,
    defineProperty: 4,
    deleteProperty: 5,
    setPrototypeOf: 6,
    preventExtensions: 7,
    construct: 8
});

/**
 * @typedef {object} MockData
 * @property {number} useCount
 * @property {string | symbol} name
 * @property {MockData} [parent]
 * @property {number} source
 * @property {unknown | unknown[]} [options]
 * @property {{[key: string | symbol]: MockData}} [mocks]
 * @property {MockData[]} [sideEffects]
 * @property {string} [instanceName]
 * @property {boolean} generated
 * @property {Function} [target]
 */

/**
 * @typedef {(v: unknown) => unknown} ReplacerFunction
 */

/**
 * @template T
 * @typedef {new (...args: unknown[]) => T} Constructor
 */

const mock = Symbol();
const unwrap = Symbol();

/**
 * @template T
 * @typedef {object} Unwrappable
 * @property {T} [unwrap]
 * @property {MockData} [mock]
 */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
const unwrapValue = (value) => (value != null && /** @type {any} */ (value)[unwrap]) || value;

/**
 * @template T
 * @param {T} value
 * @returns {MockData | undefined}
 */
const getMockData = (value) => (value != null && /** @type {any} */ (value)[mock]) || undefined;

/**
 * @returns {{createMock: <T extends object>(object: T, name: string) => T, generateGlobals: () => string, generate: (object: unknown) => string | null | undefined | RegExp | boolean}}
 */
export default function createRecordingMockFactory() {
    /** @type {MockData[]} */
    const mockDatas = [];

    let counter = 0;

    return {
        createMock,
        generateGlobals,
        generate
    };

    /**
     * @template {object} T
     * @param {T} object
     * @param {string} name
     * @returns {T}
     */
    function createMock(object, name) {
        return createInternalMock(object, {
            name,
            source: MockDataSource.root,
            useCount: 0,
            generated: false
        });
    }

    /**
     * @returns {string}
     */
    function generateGlobals() {
        /** @type {string[]} */
        const strings = [];
        for (const mockData of mockDatas) {
            if (mockData.generated) continue;
            if (!mockData.instanceName && mockData.source !== MockDataSource.root) {
                mockData.instanceName = getNextInstanceName();
            }
            const identifier = (mockData?.instanceName ?? /** @type {string} */ (mockData?.name));
            if (mockData.source !== MockDataSource.root) {
                strings.push('const ' + identifier + ' = ' + getAccessor(mockData, /** @type {MockData} */ (mockData.parent)));
            }
            for (const effect of (mockData.sideEffects || [])) {
                switch(/** @type {number} */ (effect.source)) {
                case MockDataSource.set:
                    strings.push(identifier + '.' + /** @type {string} */ (effect.name) + ' = ' + stringify(effect.options, /** @type {ReplacerFunction} */ (replacer)));
                    break;
                // case MockDataSource.defineProperty:
                //     strings.push('Object.defineProperty(' + identifier + ', "' + (effect.name as string) + '", ' + stringify(effect.options, replacer as ReplacerFunction) + ')');
                //     break;
                case MockDataSource.deleteProperty:
                    strings.push('delete ' + identifier + '["' + /** @type {string} */ (effect.name) + '"]');
                    break;
                case MockDataSource.setPrototypeOf:
                    strings.push('Object.setPrototypeOf(' + identifier + ', ' + stringify(effect.options, /** @type {ReplacerFunction} */ (replacer)) + ')');
                    break;
                case MockDataSource.preventExtensions:
                    strings.push('Object.preventExtensions(' + identifier + ')');
                    break;
                case MockDataSource.call:
                    strings.push(identifier + getParameters(/** @type {unknown[]} */ (effect.options), /** @type {ReplacerFunction} */ (replacer)));
                    break;
                }
            }
        }
        return strings.join('\n');
    
        /**
         * @param {MockData} mockData
         * @param {MockData} parent
         * @returns {string}
         */
        function getAccessor(mockData, parent) {
            const parentName = (parent?.instanceName ?? /** @type {string} */ (parent?.name));
            switch(/** @type {number} */ (mockData.source)) {
            case MockDataSource.call:
                return parentName + getParameters(/** @type {unknown[]} */ (mockData.options), /** @type {ReplacerFunction} */ (replacer));
            case MockDataSource.get:
                return parentName + '.' + /** @type {string} */ (mockData.name);
            case MockDataSource.construct:
            {
                const newTarget = stringify(mockData.target, /** @type {ReplacerFunction} */ (replacer));
                return parentName !== newTarget
                    ? 'Reflect.construct(' + parentName + ',' + stringify(mockData.options, /** @type {ReplacerFunction} */ (replacer)) + ',' + newTarget + ')'
                    : 'new ' + parentName + getParameters(/** @type {unknown[]} */ (mockData.options), /** @type {ReplacerFunction} */ (replacer));
            }
            }
            return '';
        }
    }

    /**
     * @param {unknown} object
     * @returns {string | null | undefined | RegExp | boolean}
     */
    function generate(object) {
        stringify(object, /** @type {ReplacerFunction} */ (bumpReplacer));
        return stringify(object, /** @type {ReplacerFunction} */ (replacer));
    }
    
    /**
     * @param {object & { [key: symbol]: MockData }} value
     * @returns {unknown}
     */
    function bumpReplacer(value) {
        const mockData = getMockData(value);
        if (mockData) {
            ++mockData.useCount;
            return getCode(mockData, /** @type {ReplacerFunction} */ (bumpReplacer), true);
        }
        return value;
    }
    
    /**
     * @param {object & { [key: symbol]: MockData }} value
     * @returns {unknown}
     */
    function replacer(value) {
        const mockData = getMockData(value);
        if (mockData) {
            return getCode(mockData, /** @type {ReplacerFunction} */ (replacer), true);
        }
        return value;
    }

    /**
     * @param {MockData} value
     * @param {ReplacerFunction} replacer
     * @param {boolean} bumpCount
     * @returns {string}
     */
    function getCode(value, replacer, bumpCount) {
        if (bumpCount && value.useCount > 1) {
            if (value.source === MockDataSource.root) {
                return /** @type {string} */ (value.name);
            }
            if (!value.instanceName) {
                value.instanceName = getNextInstanceName();
            }
            return value.instanceName;
        }
        value.generated = true;
        switch(/** @type {number} */ (value.source)) {
        case MockDataSource.call:
            return getPrevCode(value) + getParameters(/** @type {unknown[]} */ (value.options), replacer);
        case MockDataSource.get:
            return getPrevCode(value) + '.' + /** @type {string} */ (value.name);
        case MockDataSource.root:
            return /** @type {string} */ (value.name);
        case MockDataSource.construct:
        {
            const prevCode = getPrevCode(value);
            const newTarget = stringify(value.target, /** @type {ReplacerFunction} */ (replacer));
            return prevCode !== newTarget
                ? 'Reflect.construct(' + prevCode + ',' + stringify(value.options, /** @type {ReplacerFunction} */ (replacer)) + ',' + newTarget + ')'
                : 'new ' + prevCode + getParameters(/** @type {unknown[]} */ (value.options), /** @type {ReplacerFunction} */ (replacer));
        }
        }
        return '';

        /**
         * @param {MockData} mockData
         * @returns {string}
         */
        function getPrevCode(mockData) {
            return mockData.parent ? getCode(mockData.parent, replacer, bumpCount) : '';
        }
    }

    /**
     * @template {object} T
     * @param {T} target
     * @param {MockData} mockData
     * @returns {T}
     */
    function createInternalMock(target, mockData) {
        mockDatas.push(mockData);
        /** @type {any} */ (target)[mock] = mockData;
        return /** @type {T} */ (new Proxy(target, {
            /**
             * @param {T} target
             * @param {string | symbol} p
             * @param {unknown} value
             * @param {unknown} receiver
             * @returns {boolean}
             */
            set(target, p, value, receiver) {
                const realValue = unwrapValue(value);
                if (!mockData.sideEffects) {
                    mockData.sideEffects = [];
                }
                mockData.sideEffects.push({
                    useCount: 0,
                    name: p,
                    options: realValue,
                    parent: mockData,
                    source: MockDataSource.set,
                    generated: false
                });
                ++mockData.useCount;
                Reflect.set(target, p, realValue, receiver);
                return true;
            },
            /**
             * @param {object} target
             * @param {string | symbol} p
             * @returns {unknown}
             */
            get(target, p) {
                if (p === unwrap) return target;
                if (p === mock) return mockData;
                const value = Reflect.get(target, p);
                if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
                    return value;
                }
                if (!mockData.mocks) {
                    mockData.mocks = Object.create(null);
                }
                if (!(/** @type {{[key: string | symbol]: MockData}} */ (mockData.mocks))[p]) {
                    (/** @type {{[key: string | symbol]: MockData}} */ (mockData.mocks))[p] = createInternalMock(value, {
                        useCount: 0,
                        name: p,
                        parent: mockData,
                        source: MockDataSource.get,
                        generated: false
                    });
                }
                const result = (/** @type {{[key: string | symbol]: MockData}} */ (mockData.mocks))[p];
                ++mockData.useCount;
                return result;
            },
            /**
             * @param {Constructor<T>} target
             * @param {unknown[]} argArray
             * @param {Function} newTarget
             * @returns {T}
             */
            construct(target, argArray, newTarget) {
                const realTarget = unwrapValue(newTarget);
                const realArguments = unwrapValue(argArray);
                ++mockData.useCount;
                const result = Reflect.construct(target, /** @type {unknown[]} */ (realArguments), /** @type {Function} */ (realTarget));
                return createInternalMock(result, {
                    useCount: 0,
                    name: '',
                    options: realArguments,
                    target: /** @type {Function} */ (realTarget),
                    parent: mockData,
                    source: MockDataSource.construct,
                    generated: false
                });
            },
            /**
             * @param {T} target
             * @param {string | symbol} property
             * @param {PropertyDescriptor} attributes
             * @returns {boolean}
             */
            defineProperty(target, property, attributes) {
                const realValue = unwrapValue(attributes);
                // if (!mockData.sideEffects) {
                //     mockData.sideEffects = [];
                // }
                // mockData.sideEffects.push({
                //     useCount: 0,
                //     name: property,
                //     options: realValue,
                //     parent: mockData,
                //     source: MockDataSource.defineProperty,
                //     generated: false
                // });
                // ++mockData.useCount;
                return Reflect.defineProperty(target, property, /** @type {PropertyDescriptor} */ (realValue));
            },
            /**
             * @param {object} target
             * @param {string | symbol} p
             * @returns {boolean}
             */
            deleteProperty(target, p) {
                if (!mockData.sideEffects) {
                    mockData.sideEffects = [];
                }
                mockData.sideEffects.push({
                    useCount: 0,
                    name: p,
                    options: undefined,
                    parent: mockData,
                    source: MockDataSource.deleteProperty,
                    generated: false
                });
                ++mockData.useCount;
                const result = Reflect.deleteProperty(target, p);
                return result;
            },
            /**
             * @param {T} target
             * @param {object | null} v
             * @returns {boolean}
             */
            setPrototypeOf(target, v) {
                const realValue = unwrapValue(v);
                if (!mockData.sideEffects) {
                    mockData.sideEffects = [];
                }
                mockData.sideEffects.push({
                    useCount: 0,
                    name: '',
                    options: realValue,
                    parent: mockData,
                    source: MockDataSource.setPrototypeOf,
                    generated: false
                });
                ++mockData.useCount;
                return Reflect.setPrototypeOf(target, realValue);
            },
            /**
             * @param {T} target
             * @returns {boolean}
             */
            preventExtensions(target) {
                if (!mockData.sideEffects) {
                    mockData.sideEffects = [];
                }
                mockData.sideEffects.push({
                    useCount: 0,
                    name: '',
                    options: undefined,
                    parent: mockData,
                    source: MockDataSource.preventExtensions,
                    generated: false
                });
                ++mockData.useCount;
                return Reflect.preventExtensions(target);
            },
            /**
             * @param {Function} target
             * @param {unknown} thisArg
             * @param {unknown[]} argumentsList
             * @returns {unknown}
             */
            apply(target, thisArg, argumentsList) {
                const realThis = unwrapValue(thisArg);
                const realArguments = unwrapValue(argumentsList);
                ++mockData.useCount;
                const result = Reflect.apply(target, realThis, /** @type {unknown[]} */ (realArguments));
                if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
                    if (!mockData.sideEffects) {
                        mockData.sideEffects = [];
                    }
                    mockData.sideEffects.push({
                        useCount: 0,
                        name: '',
                        parent: mockData,
                        source: MockDataSource.call,
                        options: realArguments,
                        generated: false
                    });
                    ++mockData.useCount;
                    return result;
                }
                return createInternalMock(result, {
                    useCount: 0,
                    name: '',
                    parent: mockData,
                    source: MockDataSource.call,
                    options: realArguments,
                    generated: false
                });
            }
        }));
    }

    /**
     * @returns {string}
     */
    function getNextInstanceName() {
        return `tmp_${counter++}`;
    }
}

/**
 * @param {unknown[]} options
 * @param {ReplacerFunction} replacer
 * @returns {string}
 */
function getParameters(options, replacer) {
    return `(${options.length ? options.map(value => stringify(value, replacer)).join(',') : ''})`;
}

/**
 * stringify like functionality, recursively walks through objects and converts them to strings but leaves some basic values intact
 * @param {unknown} value
 * @param {ReplacerFunction} replacer
 * @returns {string | null | undefined | RegExp | boolean}
 */
function stringify(value, replacer) {
    const original = value;
    value = replacer(value);
    if (original !== value && typeof value === 'string') {
        return value;
    }
    if (value === null) {
        return null;
    }
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === 'number') {
        return `${value}`;
    }
    if (Array.isArray(value)) {
        return `[${value.map((v) => stringify(v, replacer)).join(',')}]`;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'function') {
        return value.toString();
    }
    if (value instanceof RegExp) {
        return value;
    }
    if (typeof value === 'object') {
        return `{${Object.entries(value).map(([k, v]) => k + ':' + stringify(v, replacer)).join(',')}}`;
    }
    return '"' + String(value) + '"';
}