# Store

Proxy-based store for SPAs.

1. Simple
2. Relatively fast
3. Small size (less than 1Kb minified not gzipped)
4. Typescript support

[Changelog](./CHANGELOG.md)

# Installation

Using npm:

```
npm install --save-dev @slimlib/store
```

# API

## Limitations

Mixing proxied values and values from an underlying object can fail for cases where code needs checking for equality.

For example searching for an array element from the underlying object in a proxied array will fail.

## Similar projects

[Valtio](https://github.com/pmndrs/valtio) - more sophisticated but similar approach

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
