# injector

Parameter names based dependency injector for nodejs.

_Limitations_

- minification of code is not supported
- not typesafe
- slower than a normal function call

[Changelog](./CHANGELOG.md)

## API

### createInject()

returns a new instance of an injector function to work with.

### injector(function, scope)

injects arguments into function and invokes it

`function` - _required_, function to inject parameters and call
`scope` - _optional_, _default_ = `{}`, this argument for the function

### $provide(key, value)

predefined injectable function

`key` - string, required
`value` - unknown

to get it, inject it into the function

```typescript
inject(($provide: Provider) => {
  $provide("service", service);
});
```

## Example

```typescript
import createInject from "@slimlib/injector";

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

# FAQ

1. Is it a good solution to mock something in unit tests?

- no, please use [jest](https://jestjs.io/), [vitest](https://vitest.dev/), [proxyquire](https://www.npmjs.com/package/proxyquire), [proxyrequire](https://www.npmjs.com/package/proxyrequire) and other similar approaches to mock modules.

2. Is it a good solution to use in frontend code?

- no, it will not work after minification

3. Is it good for nodejs applications?

- only in some edge cases, please use singletons/factories/something else if possible

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
