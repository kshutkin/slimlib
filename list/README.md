# List

Doubly linked list implementation in TypeScript.

[Changelog](./CHANGELOG.md)

## Installation

Using npm:

```
npm install --save-dev @slimlib/list
```

## API

### List() constructor

No arguments. Constructs a new list object.

```javascript
const list = new List();
```

```typescript
const list = new List<NodeType>();
```

### `[Symbol.iterator]()`

List provides an iterator using the `[Symbol.iterator]()` method. Most commonly used in cases where another statement/method consumes an iterable object.

```javascript
Array.from(list);
for (const item of list) {
  // something with item
}
```

### append(element, data)

Inserts an element after the specified element (at the end of the list when called on the list itself).

element - a `ListNode` or `List` itself, after which to add the new element

data - an object that will become a `ListNode`

### appendRange(element, begin, end)

Inserts a range of elements after the specified element (at the end of the list when called on the list itself).

element - a `ListNode` or `List` itself, after which to add the range

begin - first `ListNode` of a range

end - last `ListNode` of a range

### prepend(element, data)

Inserts an element before the specified element (at the beginning of the list when called on the list itself).

element - a `ListNode` or `List` itself, before which to add the new element

data - an object that will become a `ListNode`

### prependRange(element, begin, end)

Inserts a range of elements before the specified element (at the beginning of the list when called on the list itself).

element - a `ListNode` or `List` itself, before which to insert the range

begin - first `ListNode` of a range

end - last `ListNode` of a range

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
