// biome-ignore-all lint: test file

/**
 * Type tests for @slimlib/store
 * These tests verify TypeScript type correctness at compile time.
 * Run with `tsc --noEmit` to check for type errors.
 */

import {
    activeScope,
    type Computed,
    computed,
    debugConfig,
    type EffectCleanup,
    effect,
    flushEffects,
    type OnDisposeCallback,
    type Scope,
    type ScopeCallback,
    type ScopeFunction,
    type Signal,
    scope,
    setActiveScope,
    setScheduler,
    signal,
    state,
    untracked,
    unwrapValue,
    WARN_ON_WRITE_IN_COMPUTED,
} from '@slimlib/store';

// === Signal type tests ===

// Signal type alias is available
const typedSignal: Signal<number> = signal(0);
typedSignal.set(10);
const typedValue: number = typedSignal();

// signal with initial value infers type
const numSignal = signal(42);
const numValue: number = numSignal();
numSignal.set(100);

// @ts-expect-error - cannot set string to number signal
numSignal.set('not a number');

// signal with explicit type
const strSignal = signal<string>('hello');
const strValue: string = strSignal();
strSignal.set('world');

// @ts-expect-error - cannot set number to string signal
strSignal.set(123);

// signal without initial value is T | undefined (overload test)
const maybeSignal = signal<number>();
const maybeValue: number | undefined = maybeSignal();
maybeSignal.set(42);
maybeSignal.set(undefined);

// @ts-expect-error - cannot set string to number | undefined signal
maybeSignal.set('wrong');

// signal with object type
const objSignal = signal({ name: 'test', count: 0 });
objSignal.set({ name: 'updated', count: 1 });

// @ts-expect-error - missing required property
objSignal.set({ name: 'missing count' });

// @ts-expect-error - wrong property type
objSignal.set({ name: 123, count: 0 });

// signal with union type
const unionSignal = signal<string | null>('initial');
unionSignal.set('value');
unionSignal.set(null);

// @ts-expect-error - number not in union
unionSignal.set(42);

// === computed tests ===

// computed infers return type from getter
const doubledComputed = computed(() => numSignal() * 2);
const doubledValue: number = doubledComputed();

// @ts-expect-error - computed returns number, not string
const wrongType: string = doubledComputed();

// computed with explicit type
const explicitComputed: Computed<string> = computed(() => 'hello');
const explicitValue: string = explicitComputed();

// computed with custom equals function
const customEqualsComputed = computed(
    () => ({ value: 1 }),
    (a, b) => a.value === b.value
);

// === effect tests ===

// EffectCleanup type alias is available
const cleanup: EffectCleanup = () => {};

// effect returns dispose function
const dispose: () => void = effect(() => {
    console.log(numSignal());
});

// effect can return cleanup function (EffectCleanup)
effect(() => {
    const handler = () => {};
    return () => {
        // cleanup
    };
});

// effect can return EffectCleanup type explicitly
effect((): void | EffectCleanup => {
    return () => console.log('cleanup');
});

// effect can return void
effect(() => {
    console.log('no cleanup');
});

// @ts-expect-error - effect callback must be function
effect('not a function');

// === state tests ===

// state wraps object
const myState = state({ count: 0, name: 'test' });
myState.count = 1;
myState.name = 'updated';

// @ts-expect-error - wrong property type
myState.count = 'not a number';

// state with nested objects
const nestedState = state({
    user: { name: 'John', age: 30 },
    items: [1, 2, 3],
});
nestedState.user.name = 'Jane';
nestedState.items.push(4);

// state without argument returns object (overload test)
const emptyState: object = state();

// === scope tests ===

// scope returns Scope type
const myScope: Scope = scope();

// ScopeCallback type alias is available
const scopeCallback: ScopeCallback = onDispose => {
    onDispose(() => {});
};

// OnDisposeCallback type alias is available
const onDisposeCallback: OnDisposeCallback = cleanup => {
    // register cleanup
};

// scope with callback
const scopeWithCallback = scope(onDispose => {
    onDispose(() => {
        // cleanup
    });
});

// scope with parent
const childScope = scope(undefined, myScope);

// scope with null parent (detached)
const detachedScope = scope(undefined, null);

// calling scope disposes it
myScope();

// setActiveScope accepts Scope or undefined
setActiveScope(myScope);
setActiveScope(undefined);

// @ts-expect-error - setActiveScope does not accept null
setActiveScope(null);

// activeScope is Scope | undefined
const currentScope: Scope | undefined = activeScope;

// ScopeFunction type is available
const _scopeFunc: ScopeFunction = myScope;

// === debugConfig tests ===

// debugConfig accepts number flags
debugConfig(WARN_ON_WRITE_IN_COMPUTED);
debugConfig(0);

// WARN_ON_WRITE_IN_COMPUTED is a number
const flag: number = WARN_ON_WRITE_IN_COMPUTED;

// @ts-expect-error - debugConfig does not accept string
debugConfig('invalid');

// === setScheduler tests ===

// setScheduler accepts callback function
setScheduler(callback => {
    setTimeout(callback, 0);
});

setScheduler(callback => {
    requestAnimationFrame(callback);
});

// @ts-expect-error - scheduler must be function
setScheduler('not a function');

// === flushEffects tests ===

// flushEffects returns void
const flushResult: void = flushEffects();

// === unwrapValue tests ===

// unwrapValue preserves type
const unwrappedNum: number = unwrapValue(42);
const unwrappedStr: string = unwrapValue('hello');
const unwrappedObj: { a: number } = unwrapValue({ a: 1 });

// === untracked tests ===

// untracked infers return type
const untrackedNum: number = untracked(() => numSignal());
const untrackedStr: string = untracked(() => 'hello');

// @ts-expect-error - return type mismatch
const wrongUntracked: string = untracked(() => 42);

// === complex type scenarios ===

// generic function using signals
function createCounter(initial: number) {
    const count = signal(initial);
    const doubled = computed(() => count() * 2);
    return { count, doubled };
}

const counter = createCounter(0);
counter.count.set(5);
const d: number = counter.doubled();

// array of signals
const signals: Array<ReturnType<typeof signal<number>>> = [signal(1), signal(2), signal(3)];

signals.forEach(s => s.set(s() + 1));

// conditional types with signals
type SignalValue<S> = S extends () => infer T ? T : never;
type NumSignalValue = SignalValue<typeof numSignal>; // should be number

const _typeCheck: NumSignalValue = 42;

// @ts-expect-error - NumSignalValue is number, not string
const _wrongTypeCheck: NumSignalValue = 'string';
