/**
 * A Context Protocol key.
 *
 * The `__context__` property is a type-only brand used to carry the value type.
 */
export type Context<KeyType, ValueType> = KeyType & { readonly __context__: ValueType };

export type UnknownContext = Context<unknown, unknown>;

export type ContextType<T extends UnknownContext> = T extends Context<infer _KeyType, infer ValueType> ? ValueType : never;

export type ContextCallback<ValueType> = (value: ValueType, unsubscribe?: () => void) => void;

export type ContextRequestEventLike<T extends UnknownContext> = Event & {
    readonly context: T;
    readonly callback: ContextCallback<ContextType<T>>;
    readonly subscribe?: boolean;
};
