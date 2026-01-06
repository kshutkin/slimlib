# injector

Parameter names based dependency injector for nodejs.

[Changelog](./CHANGELOG.md)

## API

### createInject()

Returns a new instance of an injector function to work with.

_Limitations_

- minification of code is not supported (use `createInjectAnnotated` instead)
- not typesafe
- slower than a normal function call

### createInjectAnnotated()

Returns a new instance of an injector function that uses AngularJS-style array annotation for minification safety.

Instead of parsing parameter names, it expects dependencies to be specified as strings in an array before the function:

```typescript
inject(["dep1", "dep2", (dep1, dep2) => { ... }]);
```

This allows code to be minified since the dependency names are preserved as strings.

> **Note:** The input array is mutated during injection (the function is removed via `pop()`). Always use inline array literals or create a fresh array for each call if you need to reuse the dependency list.

### injector(function, scope)

Injects arguments into function and invokes it.

`function` - _required_, function to inject parameters and call (or annotated array for `createInjectAnnotated`)
`scope` - _optional_, _default_ = `{}`, this argument for the function

### $provide(key, value)

Predefined injectable function.

`key` - string, required
`value` - unknown

To get it, inject it into the function:

```typescript
inject(($provide: Provider) => {
  $provide("service", service);
});
```

## Examples

### Using createInject (development / non-minified)

```typescript
import { createInject } from "@slimlib/injector";

const inject = createInject();

inject(($provide: Provider) => {
  $provide("config", {
    url: "http://example.com/json",
    format: "json",
  });
});

inject(async (config: Json) => {
  const data = await fetch(config.url);
  const result = config.json ? await data.json() : data;
  // and so on
});
```

### Using createInjectAnnotated (minification-safe)

```typescript
import { createInjectAnnotated } from "@slimlib/injector";

const inject = createInjectAnnotated();

inject([
  "$provide",
  ($provide: Provider) => {
    $provide("config", {
      url: "http://example.com/json",
      format: "json",
    });
  },
]);

inject([
  "config",
  async (config: Json) => {
    const data = await fetch(config.url);
    const result = config.json ? await data.json() : data;
    // and so on
  },
]);
```

This style is similar to AngularJS's dependency injection annotation:

```javascript
// Before minification
angular.module("App", []).controller("MyController", function ($scope) {
  $scope.value = "test";
});

// After minification (broken)
angular.module("App", []).controller("MyController", function (a) {
  a.value = "test";
});

// With array annotation (works after minification)
angular.module("App", []).controller("MyController", [
  "$scope",
  function (a) {
    a.value = "test";
  },
]);
```

## Build-time Swapping

You can use `createInject` during development and swap to `createInjectAnnotated` at build time for production. This can be done with build tools like Rollup, Webpack, or esbuild by aliasing the import.

# FAQ

1. Is it a good solution to mock something in unit tests?

- No, please use [jest](https://jestjs.io/), [vitest](https://vitest.dev/), [proxyquire](https://www.npmjs.com/package/proxyquire), [proxyrequire](https://www.npmjs.com/package/proxyrequire) and other similar approaches to mock modules.

2. Is it a good solution to use in frontend code?

- `createInject` will not work after minification, but `createInjectAnnotated` is designed to work with minified code.

3. Is it good for nodejs applications?

- Only in some edge cases, please use singletons/factories/something else if possible.

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
