declare module '@slimlib/store' {
	export function unwrapValue<T>(value: T): T;
	export function createStoreFactory(): <T extends object>(object?: T) => [T, Store<T>, () => void];
	export type StoreCallback<T> = (value: T) => void;
	export type UnsubscribeCallback = () => void;
	export type StoreFunction<T> = {
		/**
		 * - Subscribe to store changes
		 */
		subscribe: (cb: StoreCallback<T>) => UnsubscribeCallback;
		/**
		 * - Get current store value
		 */
		get: () => Readonly<T>;
	};
	export type Store<T> = ((cb: StoreCallback<T>) => UnsubscribeCallback) & (() => Readonly<T>);
	export type Unwrappable<T> = T & {
		[unwrap]: T;
	};




	const unwrap: unique symbol;

	export {};
}

//# sourceMappingURL=index.d.ts.map