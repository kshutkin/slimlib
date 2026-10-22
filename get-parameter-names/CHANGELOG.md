Changelog

## 1.0.2

### Patch Changes

- 545127d: Preserve parameter positions when default values contain commas inside quoted strings, arrays, or objects.
- 3cdc9c2: Inline the parameter parser's regular expressions to reduce minified size, with comments explaining literal masking and identifier boundaries.
- 67ec61e: Preserve identifiers containing static when extracting function and constructor parameter names.

## 1.0.1

### Patch Changes

- dcb7ca7: remove comments, flatten packages

## 1.0.0

### Major Changes

- ac961c9: initial release

### Minor Changes

- ac961c9: Changed from default export to named export. Import using `{ getParameterNames }` instead of the default import.

  **Before:**

  ```js
  import getParameterNames from "@slimlib/get-parameter-names";
  ```

  **After:**

  ```js
  import { getParameterNames } from "@slimlib/get-parameter-names";
  ```
