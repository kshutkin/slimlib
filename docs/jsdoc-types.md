# JSDoc Type Notes

## Module file convention (`element/src`)

In `element/src`, JSDoc-only shared type files referenced via `import('./types.js').Name` must include `export {};` so TypeScript treats the file as a module; this creates no runtime public export.
