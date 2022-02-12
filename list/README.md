# List

Doubly linked list implementation in typescript.

## Installation

Using npm:
```
npm install --save-dev @slimlib/list
```

## API

### List() constructor

No arguments. Constructs a new list object.

```javascript
const list = new List;
```

```typescript
const list = new List<NodeType>;
```

### `[Symbol.iterator]()`

List provides iterator using `[Symbol.iterator]()` method. Most commonly used in cases where another statement/method consumes iterable object.

```javascript
Array.from(list);
for (const item of list) {
    // something with item
}
```

### append(element, data)

inserts an element after element (at the end of the list in case of list)

element - `ListNode` or `List` itself to add a new element after

data - object that will become a `ListNode`

### appendRange(element, begin, end)

inserts a range of elements after element (at the end of the list in case of list)

element - `ListNode` or `List` itself to add range after

begin - first `ListNode` of a range

end - last `ListNode` of a range

### prepend(element, data)

inserts an element before element (at the beginning of the list in case of list)

element - `ListNode` or `List` itself to add a new element before

data - object that will become a `ListNode`

### prependRange(element, begin, end)

inserts a range of elements before element (at the beginning of the list in case of list)

element - `ListNode` or `List` itself to insert range before

begin - first `ListNode` of a range

end - last `ListNode` of a range

# License

[MIT](./LICENSE)