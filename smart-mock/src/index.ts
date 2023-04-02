export const enum MockDataSource {
    root,
    get,
    call,
    set,
    defineProperty,
    deleteProperty,
    setPrototypeOf,
    preventExtensions,
    construct
}

interface MockData {
    useCount: number;
    name: string | symbol;
    parent?: MockData;
    source: MockDataSource;
    options?: unknown | unknown[];
    mocks?: {[key: string | symbol]: MockData}
    sideEffects?: MockData[]
    instanceName?:  string;
    generated: boolean;
    // eslint-disable-next-line @typescript-eslint/ban-types
    target?: Function;
}

type ReplacerFunction = (v: unknown) => unknown;
type Constructor<T> = new (...args: any[]) => T;

const mock = Symbol();
const unwrap = Symbol();

type Unwrappable<T> = {
    [unwrap]: T;
    [mock]: MockData;
} & T;

const unwrapValue = <T>(value: T) => (value != null && (value as Unwrappable<T>)[unwrap]) || value;
const getMockData = <T>(value: T) => (value != null && (value as Unwrappable<T>)[mock]) || undefined;

export default function createRecordingMockFactory() {
    const mockDatas: MockData[] = [];

    let counter = 0;

    return {
        createMock,
        generateGlobals,
        generate
    };

    function createMock<T extends object>(object: T, name: string): T {
        return createInternalMock(object, {
            name,
            source: MockDataSource.root,
            useCount: 0,
            generated: false
        });
    }

    function generateGlobals() {
        const strings = [];
        for (const mockData of mockDatas) {
            if (mockData.generated) continue;
            if (!mockData.instanceName && mockData.source !== MockDataSource.root) {
                mockData.instanceName = getNextInstanceName();
            }
            const identifier = (mockData?.instanceName ?? mockData?.name as string);
            if (mockData.source !== MockDataSource.root) {
                strings.push('const ' + identifier + ' = ' + getAccessor(mockData, mockData.parent as MockData));
            }
            for (const effect of (mockData.sideEffects || [])) {
                switch(effect.source as MockDataSource.set | /*MockDataSource.defineProperty |*/ MockDataSource.deleteProperty | MockDataSource.setPrototypeOf | MockDataSource.preventExtensions | MockDataSource.call) {
                case MockDataSource.set:
                    strings.push(identifier + '.' + (effect.name as string) + ' = ' + stringify(effect.options, replacer as ReplacerFunction));
                    break;
                // case MockDataSource.defineProperty:
                //     strings.push('Object.defineProperty(' + identifier + ', "' + (effect.name as string) + '", ' + stringify(effect.options, replacer as ReplacerFunction) + ')');
                //     break;
                case MockDataSource.deleteProperty:
                    strings.push('delete ' + identifier + '["' + (effect.name as string) + '"]');
                    break;
                case MockDataSource.setPrototypeOf:
                    strings.push('Object.setPrototypeOf(' + identifier + ', ' + stringify(effect.options, replacer as ReplacerFunction) + ')');
                    break;
                case MockDataSource.preventExtensions:
                    strings.push('Object.preventExtensions(' + identifier + ')');
                    break;
                case MockDataSource.call:
                    strings.push(identifier + getParameters(effect.options as unknown[], replacer as ReplacerFunction));
                    break;
                }
            }
        }
        return strings.join('\n');
    
        function getAccessor(mockData: MockData, parent: MockData) {
            const parentName = (parent?.instanceName ?? parent?.name as string);
            switch(mockData.source as MockDataSource.call | MockDataSource.get | MockDataSource.construct) {
            case MockDataSource.call:
                return parentName + getParameters(mockData.options as unknown[], replacer as ReplacerFunction);
            case MockDataSource.get:
                return parentName + '.' + (mockData.name as string);
            case MockDataSource.construct:
            {
                const newTarget = stringify(mockData.target, replacer as ReplacerFunction);
                return parentName !== newTarget
                    ? 'Reflect.construct(' + parentName + ',' + stringify(mockData.options, replacer as ReplacerFunction) + ',' + newTarget + ')'
                    : 'new ' + parentName + getParameters(mockData.options as unknown[], replacer as ReplacerFunction);
            }
            }
        }
    }

    function generate(object: unknown) {
        stringify(object, bumpReplacer as ReplacerFunction);
        return stringify(object, replacer as ReplacerFunction);
    }
    
    function bumpReplacer(value: object & { [mock]: MockData }) {
        const mockData = getMockData(value);
        if (mockData) {
            ++mockData.useCount;
            return getCode(mockData, bumpReplacer as ReplacerFunction, true);
        }
        return value;
    }
    
    function replacer(value: object & { [mock]: MockData }) {
        const mockData = getMockData(value);
        if (mockData) {
            return getCode(mockData, replacer as ReplacerFunction, true);
        }
        return value;
    }

    function getCode(value: MockData, replacer: ReplacerFunction, bumpCount: boolean): string {
        if (bumpCount && value.useCount > 1) {
            if (value.source === MockDataSource.root) {
                return value.name as string;
            }
            if (!value.instanceName) {
                value.instanceName = getNextInstanceName();
            }
            return value.instanceName;
        }
        value.generated = true;
        switch(value.source as MockDataSource.call | MockDataSource.get | MockDataSource.root | MockDataSource.construct) {
        case MockDataSource.call:
            return getPrevCode(value) + getParameters(value.options as unknown[], replacer);
        case MockDataSource.get:
            return getPrevCode(value) + '.' + (value.name as string);
        case MockDataSource.root:
            return value.name as string;
        case MockDataSource.construct:
        {
            const prevCode = getPrevCode(value);
            const newTarget = stringify(value.target, replacer as ReplacerFunction);
            return prevCode !== newTarget
                ? 'Reflect.construct(' + prevCode + ',' + stringify(value.options, replacer as ReplacerFunction) + ',' + newTarget + ')'
                : 'new ' + prevCode + getParameters(value.options as unknown[], replacer as ReplacerFunction);
        }
        }

        function getPrevCode(mockData: MockData) {
            return mockData.parent ? getCode(mockData.parent, replacer, bumpCount) : '';
        }
    }

    function createInternalMock<T extends object>(target: T, mockData: MockData): T {
        mockDatas.push(mockData);
        (target as Unwrappable<T>)[mock] = mockData;
        return new Proxy(target, {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            set(target: T, p: string | symbol, value: any, receiver: any) {
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
            get(target: object, p: string | symbol) {
                if (p === unwrap) return target;
                if (p === mock) return mockData;
                const value = Reflect.get(target, p);
                if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
                    return value;
                }
                if (!mockData.mocks) {
                    mockData.mocks = Object.create(null);
                }
                if (!(mockData.mocks as {[key: string | symbol]: MockData})[p]) {
                    (mockData.mocks as {[key: string | symbol]: MockData})[p] = createInternalMock(value, {
                        useCount: 0,
                        name: p,
                        parent: mockData,
                        source: MockDataSource.get,
                        generated: false
                    });
                }
                const result = (mockData.mocks as {[key: string | symbol]: MockData})[p];
                ++mockData.useCount;
                return result;
            },
            // eslint-disable-next-line @typescript-eslint/ban-types
            construct(target: Constructor<T>, argArray: any[], newTarget: Function) {
                const realTarget = unwrapValue(newTarget);
                const realArguments = unwrapValue(argArray);
                ++mockData.useCount;
                const result = Reflect.construct(target, realArguments, realTarget);
                return createInternalMock(result, {
                    useCount: 0,
                    name: '',
                    options: realArguments,
                    target: realTarget,
                    parent: mockData,
                    source: MockDataSource.construct,
                    generated: false
                });
            },
            defineProperty(target: T, property: string | symbol, attributes: PropertyDescriptor) {
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
                return Reflect.defineProperty(target, property, realValue);
            },
            deleteProperty(target: object, p: string | symbol) {
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
            setPrototypeOf(target: T, v: object | null) {
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
            preventExtensions(target: T) {
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
            apply(target: never, thisArg: never, argumentsList: never[]) {
                const realThis = unwrapValue(thisArg);
                const realArguments = unwrapValue(argumentsList);
                ++mockData.useCount;
                const result = Reflect.apply(target, realThis, realArguments);
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
        }) as T;
    }

    function getNextInstanceName() {
        return `tmp_${counter++}`;
    }
}

function getParameters(options: unknown[], replacer: ReplacerFunction) {
    return `(${options.length ? options.map(value => stringify(value, replacer)).join(',') : ''})`;
}

// stringify like functionality, recursively walks through objects and converts them to strings but leaved some basic values intact
function stringify(value: unknown, replacer: ReplacerFunction): string | null | undefined | RegExp | boolean {
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
