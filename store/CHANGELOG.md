Changelog

## 1.6.0

### Minor Changes

- 890ab16: added rxjs support

## 1.5.2

### Patch Changes

- c59d365: fix documentation because we export 2 functions from `core` already for some time

## 1.5.1

### Patch Changes

- 77b2fe3: added generic parameter in example

## 1.5.0

### Minor Changes

- 11ccb93: added select() helper and updated documentation

## 1.4.1

### Patch Changes

- 118f643: Angular toSignal:
  - use hard link to signal
  - use untracked when setting signal state

## 1.4.0

### Minor Changes

- a1039b6: added angular signals basic implementation

## 1.3.6

### Patch Changes

- 552eed5: update to a newer project structure

## 1.3.5

### Patch Changes

- 2914a39: Updated readme files

## 1.3.4

### Patch Changes

- 334ff44: fixed spelling in readmes, added links to changelogs

# [@slimlib/store-v1.3.3](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.3.2...@slimlib/store-v1.3.3) (2022-12-20)

### Bug Fixes

- added LICENSE to files, fixed README path ([4880527](https://github.com/kshutkin/slimlib/commit/4880527d54cf874317b18926856bdb01c16fa6cf))
- update pkgbld-internal one more time ([63efced](https://github.com/kshutkin/slimlib/commit/63efced8ec63a8331b4ddf8618d46a8a89419482))

# [@slimlib/store-v1.3.2](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.3.1...@slimlib/store-v1.3.2) (2022-11-01)

### Bug Fixes

- added keywords ([4477f88](https://github.com/kshutkin/slimlib/commit/4477f8864e45deba1d9275ddc9dd462b3bdd9860))

# [@slimlib/store-v1.3.1](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.3.0...@slimlib/store-v1.3.1) (2022-10-20)

### Bug Fixes

- build on node => 16 but not specify this as requirement in packages ([00a42ff](https://github.com/kshutkin/slimlib/commit/00a42ffb747ae4a58f2b9e96d7cc93b3d71edb99))
- use new pkgbld, fixes exports in subpackages ([d84b5f3](https://github.com/kshutkin/slimlib/commit/d84b5f3c6266f7f6f011110954f52fbf40df32db))

# [@slimlib/store-v1.3.0](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.2.0...@slimlib/store-v1.3.0) (2022-07-03)

### Features

- trigger notifications function (resolves [#8](https://github.com/kshutkin/slimlib/issues/8)) ([a5587b8](https://github.com/kshutkin/slimlib/commit/a5587b86861c5beac2a6e6b4081b3ef7f1b584ae))

# [@slimlib/store-v1.2.0](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.1.3...@slimlib/store-v1.2.0) (2022-07-03)

### Features

- unwrapValue (resolves [#7](https://github.com/kshutkin/slimlib/issues/7)) ([b86fc07](https://github.com/kshutkin/slimlib/commit/b86fc076b390d64edc717c4d54c3e5de1e601df7))

# [@slimlib/store-v1.1.3](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.1.2...@slimlib/store-v1.1.3) (2022-07-03)

### Bug Fixes

- add stores to dependencies lists (fixes [#6](https://github.com/kshutkin/slimlib/issues/6)) ([4b80625](https://github.com/kshutkin/slimlib/commit/4b80625ccc4b62df8ad7ced1c75803d158beb377))

# [@slimlib/store-v1.1.2](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.1.1...@slimlib/store-v1.1.2) (2022-03-23)

### Bug Fixes

- readme links ([fbeb35d](https://github.com/kshutkin/slimlib/commit/fbeb35dc30ed5e0e59bfcabed314ffaeb2eaac2b))

# [@slimlib/store-v1.1.1](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.1.0...@slimlib/store-v1.1.1) (2022-03-23)

### Bug Fixes

- export ./package.json ([1d04da5](https://github.com/kshutkin/slimlib/commit/1d04da5bf8d8b5b9d5de6099b6ee70d3bc448e40))

# [@slimlib/store-v1.1.0](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.0.1...@slimlib/store-v1.1.0) (2022-02-26)

### Features

- implement subpackages to support some SPA libraries ([#4](https://github.com/kshutkin/slimlib/issues/4)) ([d460d7f](https://github.com/kshutkin/slimlib/commit/d460d7fc4bc7343de699f61e322b87a0aa32cf99))

# [@slimlib/store-v1.0.1](https://github.com/kshutkin/slimlib/compare/@slimlib/store-v1.0.0...@slimlib/store-v1.0.1) (2022-02-23)

### Bug Fixes

- prevent storing of Proxified objects in underlying storage ([8888779](https://github.com/kshutkin/slimlib/commit/8888779fe26fb3a901c9deb08ebc017424b73cc5))

# @slimlib/store-v1.0.0 (2022-02-19)

### Bug Fixes

- scope ([04d696b](https://github.com/kshutkin/slimlib/commit/04d696bc5bf208f5d127997fa85f345756a96c78))

### Features

- store ([#3](https://github.com/kshutkin/slimlib/issues/3)) ([109752f](https://github.com/kshutkin/slimlib/commit/109752f12d4af4ee514b5e1c21f5a9c4b7fc5c91))
