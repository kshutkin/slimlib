# Smart Mock

Yet another proxy mock (YAPM?). Still in a very early state (EXPECT BUGS!).

A mock that records operations for code generation later. The idea is somewhat similar to `prepack`, but instead of interpreting code by other JS code, we run it in a JS VM and later use the mock to repeat the same operations. Ideally combined with a terser-like optimizer. Please check the example in `pkgbld` to see how it is used to eject config.

[Changelog](./CHANGELOG.md)

## API

### default `() => { createMock, generateGlobals, generate }`

The default export function is a factory that creates 3 other functions with shared state.

### `createMock<T extends object>(object: T, name: string): T`

Function to create a mock wrapper around an object and define a global name for later usage. `object` can be a real original object or a pure mock object with the same behavior for the specific situation. All operations on this object will be recorded by the mock.

### `generate(object: unknown): string`

Function to generate code for some export point (exit point). It will try to automatically inline operations that can be inlined.

### `generateGlobals(): string`

Function to generate global code that cannot be inlined to an exit point.

### Example

```javascript
import createMockProvider from "@slimlib/smart-mock";
const { createMock, generate, generateGlobals } = createMockProvider();
const mock = createMock(
  {
    fly() {
      return { status: "flying" };
    },
    land() {},
    name: "",
  },
  "fly"
);
mock.name = "Moth";
const status = mock.fly();
mock.land();
```

At this point `generate(mock)` will result in `mock`, `generate(mock.name)` in `'Moth'` and `generate(status)` in `fly.fly()`. And if you afterwards call `generateGlobals()` you get something like:

```javascript
fly.name = "Moth";
const tmp_0 = fly.land;
tmp_0();
```

Each `generate` call updates counters / flags in the mock so `generateGlobals` only emits what was not generated at the time of the call.

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
