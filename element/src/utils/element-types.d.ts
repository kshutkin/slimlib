import type { Middleware } from '../types.js';

/** Collapse a union of types into an intersection */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

/** Extract the phantom instance-extension from a single Middleware */
type ExtractInstanceExt<M> = M extends Middleware<infer E> ? E : object;

/**
 * Merge all instance-extensions from a Middleware tuple into a single
 * intersection type, giving the element class its typed properties.
 */
export type MergeInstanceExts<M extends readonly Middleware<object>[]> = UnionToIntersection<ExtractInstanceExt<M[number]>>;
