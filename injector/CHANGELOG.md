Changelog

## 2.0.1

### Patch Changes

- 252ad95: readme updates

## 2.0.0

### Major Changes

- ac961c9: new build and new get parameters name implementation

### Minor Changes

- ac961c9: Changed from default export to named export. Import using `{ createInject }` instead of the default import.

  **Before:**

  ```js
  import createInject from "@slimlib/injector";
  ```

  **After:**

  ```js
  import { createInject } from "@slimlib/injector";
  ```

  Added `createInjectAnnotated` function for minification-safe dependency injection using AngularJS-style array annotation.

  ```js
  import { createInjectAnnotated } from "@slimlib/injector";

  const inject = createInjectAnnotated();

  inject([
    "$provide",
    ($provide) => {
      $provide("config", { url: "http://example.com" });
    },
  ]);

  inject([
    "config",
    (config) => {
      console.log(config.url);
    },
  ]);
  ```

### Patch Changes

- Updated dependencies [ac961c9]
- Updated dependencies [ac961c9]
  - @slimlib/get-parameter-names@1.0.0

## 1.0.6

### Patch Changes

- e157d13: use prune on package.json

## 1.0.5

### Patch Changes

- 552eed5: update to a newer project structure

## 1.0.4

### Patch Changes

- 2914a39: Updated readme files

## 1.0.3

### Patch Changes

- 334ff44: fixed spelling in readmes, added links to changelogs

# [@slimlib/injector-v1.0.2](https://github.com/kshutkin/slimlib/compare/@slimlib/injector-v1.0.1...@slimlib/injector-v1.0.2) (2023-01-23)

### Bug Fixes

- added keywords ([fbaadc4](https://github.com/kshutkin/slimlib/commit/fbaadc490f7955d2478ba430236d7c5cb42f4c0b))

# [@slimlib/injector-v1.0.1](https://github.com/kshutkin/slimlib/compare/@slimlib/injector-v1.0.0...@slimlib/injector-v1.0.1) (2022-12-20)

### Bug Fixes

- added LICENSE to files, fixed README path ([4880527](https://github.com/kshutkin/slimlib/commit/4880527d54cf874317b18926856bdb01c16fa6cf))
- update pkgbld-internal one more time ([63efced](https://github.com/kshutkin/slimlib/commit/63efced8ec63a8331b4ddf8618d46a8a89419482))

# @slimlib/injector-v1.0.0 (2022-11-01)

### Features

- injector initial implementation ([3fef704](https://github.com/kshutkin/slimlib/commit/3fef704e583022345d9dd07753b3886f00d5ff44))
