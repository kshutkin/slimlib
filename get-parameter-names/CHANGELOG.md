Changelog

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
