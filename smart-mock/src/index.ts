export const enum ObjectPathSource { root, get, call }

interface ObjectPath {
    useCount: number;
    name: string | symbol;
    parent?: ObjectPath;
    source: ObjectPathSource;
    options?: unknown[];
    mocks?: {[key: string | symbol]: ObjectPath}
    instanceName?:  string;
    generated: boolean;
}

type ReplacerFunction = (v: unknown) => unknown;

const ops = Symbol();
const unwrap = Symbol();
const op: ObjectPath[] = [];

type Unwrappable<T> = {
    [unwrap]: T;
    [ops]: ObjectPath;
} & T;

export function reset() {
    op.length = 0;
    counter = 0;
}

export function rootMock<T extends object>(o: T, name:  string): T {
    return createMock(o, {
        name,
        source: ObjectPathSource.root,
        useCount: 0,
        generated: true
    });
}

export function generate<T extends object>(object: T) {
    stringify(object, bumpReplacer as ReplacerFunction);
    return stringify(object, replacer as ReplacerFunction);
}

export function generateGlobals() {
    const strings = [];
    for (const o of op) {
        if (o.generated) continue;
        if (!o.instanceName) {
            o.instanceName = getNextInstanceName();
        }
        strings.push('const ' + o.instanceName + ' = ' + getAccessor(o, o.parent as ObjectPath));
    }
    return strings.join('\n');

    function getAccessor(o: ObjectPath, parent: ObjectPath) {
        const parentName = (parent?.instanceName ?? parent?.name as string);
        switch(o.source as ObjectPathSource.call | ObjectPathSource.get) {
        case ObjectPathSource.call:
            return parentName + getParameters(o.options as unknown[], replacer as ReplacerFunction);
        case ObjectPathSource.get:
            return parentName + '.' + (o.name as string);
        }
    }
}

export const unwrapValue = <T>(value: T) => (value != null && (value as Unwrappable<T>)[unwrap]) || value;

function createMock<T extends object>(target: T, objectPath: ObjectPath): T {
    op.push(objectPath);
    (target as Unwrappable<T>)[ops] = objectPath;
    return new Proxy(target, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set(target: T, p: string | symbol, value: any, receiver: any) {
            const realValue = unwrapValue(value);
            // TODO update objectPath
            if (Reflect.get(target, p, receiver) !== realValue) {
                Reflect.set(target, p, realValue, receiver);
            }
            return true;
        },
        get(target: object, p: string | symbol) {
            if (p === unwrap) return target;
            if (p === ops) return objectPath;
            if (!objectPath.mocks) {
                objectPath.mocks = Object.create(null);
            }
            if (!(objectPath.mocks as {[key: string | symbol]: ObjectPath})[p]) {
                (objectPath.mocks as {[key: string | symbol]: ObjectPath})[p] = createMock(Reflect.get(target, p), {
                    useCount: 0,
                    name: p,
                    parent: objectPath,
                    source: ObjectPathSource.get,
                    generated: false
                });
            }
            const result = (objectPath.mocks as {[key: string | symbol]: ObjectPath})[p];
            ++objectPath.useCount;
            return result;
        },
        defineProperty(...args: [never, string | symbol, PropertyDescriptor]) {
            // TODO update objectPath
            return Reflect.defineProperty(...args);
        },
        deleteProperty(target: object, p: string | symbol) {
            // TODO update objectPath
            const result = Reflect.deleteProperty(target, p);
            return result;
        },
        apply(target: never, thisArg: never, argumentsList: never[]) {
            ++objectPath.useCount;
            return createMock(Reflect.apply(target, thisArg, argumentsList), {
                useCount: 0,
                name: '',
                parent: objectPath,
                source: ObjectPathSource.call,
                options: argumentsList,
                generated: false
            });
        }
    }) as T;
}

function bumpReplacer(value: object & { [ops]: ObjectPath }) {
    const op = getObjectPath(value);
    if (op) {
        ++op.useCount;
        return getCode(op, bumpReplacer as ReplacerFunction, true);
    }
    return value;
}

function replacer(value: object & { [ops]: ObjectPath }) {
    const op = getObjectPath(value);
    if (op) {
        return getCode(op, replacer as ReplacerFunction, true);
    }
    return value;
}


function getObjectPath(mock: object & { [ops]: ObjectPath }) {
    return mock != null ? mock[ops] : undefined;
}

function getCode(value: ObjectPath, repl: ReplacerFunction, bumpCount: boolean): string {
    if (bumpCount && value.useCount > 1) {
        if (!value.instanceName) {
            value.instanceName = getNextInstanceName();
        }
        return value.instanceName;
    }
    value.generated = true;
    switch(value.source) {
    case ObjectPathSource.call:
        return getCallCode(value.parent as ObjectPath, value);
    case ObjectPathSource.get:
        return (getPrevCode(value)) + (value.name as string);
    case ObjectPathSource.root:
        return value.name as string;
    }

    function getCallCode(parent: ObjectPath, value: ObjectPath): string {
        parent.generated = true;
        return getPrevCode(parent) + (parent.name as string) + getParameters(value.options as unknown[], repl);
    }

    function getPrevCode(op: ObjectPath) {
        return op.parent ? getCode(op.parent, repl, bumpCount) + '.' : '';
    }
}

function getParameters(options: unknown[], replacer: ReplacerFunction) {
    return `(${options.length ? options.map(value => stringify(value, replacer)).join(',') : ''})`;
}

function stringify(o: unknown, replacer: ReplacerFunction): string | null | undefined | RegExp | boolean {
    const original = o;
    o = replacer(o);
    if (original !== o && typeof o === 'string') {
        return o;
    }
    if (o === null) {
        return null;
    }
    if (o === undefined) {
        return undefined;
    }
    if (typeof o === 'number') {
        return `${o}`;
    }
    if (Array.isArray(o)) {
        return `[${o.map((v) => stringify(v, replacer)).join(',')}]`;
    }
    if (typeof o === 'boolean') {
        return o;
    }
    if (typeof o === 'function') {
        return o.toString();
    }
    if (o instanceof RegExp) {
        return o;
    }
    if (typeof o === 'object') {
        return `{${Object.entries(o).map(([key, v]) => key + ':' + stringify(v, replacer)).join(',')}}`;
    }
    return String(o);
}

let counter = 0;

function getNextInstanceName() {
    return `tmp_${counter++}`;
}

