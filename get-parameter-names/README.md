# Get Parameter Names

Parse a function and extract its parameter names.

Based on [get-parameter-names](https://github.com/CaptEmulation/get-parameter-names) (MIT).

[Changelog](./CHANGELOG.md)

## Installation

Using npm:
```
npm install @slimlib/get-parameter-names
```

Using pnpm:
```
pnpm add @slimlib/get-parameter-names
```

## Usage

```javascript
import getParameterNames from '@slimlib/get-parameter-names';

function example(foo, bar, baz) {
    return foo + bar + baz;
}

const params = getParameterNames(example);
console.log(params); // ['foo', 'bar', 'baz']
```

## API

### `getParameterNames(input)`

Parse a function and extract its parameter names.

**Parameters:**
- `input` - `Function | string` - The function or function string to parse

**Returns:** `string[]` - Array of parameter names

## Features

- Supports regular functions
- Supports ES2015+ arrow functions (with and without parentheses)
- Supports async functions
- Supports default parameters
- Supports class constructors
- Handles comments in function signatures
- Handles nested functions and arrow functions
- Works with functions created using the Function constructor

## Examples

### Regular Functions

```javascript
function add(a, b, c) {
    return a + b + c;
}
getParameterNames(add); // ['a', 'b', 'c']
```

### Arrow Functions

```javascript
const multiply = (x, y) => x * y;
getParameterNames(multiply); // ['x', 'y']

const square = x => x * x;
getParameterNames(square); // ['x']
```

### Async Functions

```javascript
async function fetchData(url, options) {
    return await fetch(url, options);
}
getParameterNames(fetchData); // ['url', 'options']
```

### Default Parameters

```javascript
function greet(name, greeting = 'Hello') {
    return `${greeting}, ${name}!`;
}
getParameterNames(greet); // ['name', 'greeting']
```

### Class Constructors

```javascript
class User {
    constructor(name, email, age) {
        this.name = name;
        this.email = email;
        this.age = age;
    }
}
getParameterNames(User); // ['name', 'email', 'age']
```

### Function Strings

```javascript
const fnString = '(a, b) => a + b';
getParameterNames(fnString); // ['a', 'b']
```

## License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
