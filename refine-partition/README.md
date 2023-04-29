# Refine Partition

Simple refine partition implementation

https://en.wikipedia.org/wiki/Partition_refinement

> To perform a refinement operation, the algorithm loops through the elements of the given set X. For each such element x, it finds the set Si that contains x, and checks whether a second set for Si ∩ X has already been started. If not, it creates the second set and adds Si to a list L of the sets that are split by the operation. Then, regardless of whether a new set was formed, the algorithm removes x from Si and adds it to Si ∩ X. In the representation in which all elements are stored in a single array, moving x from one set to another may be performed by swapping x with the final element of Si and then decrementing the end index of Si and the start index of the new set. Finally, after all elements of X have been processed in this way, the algorithm loops through L, separating each current set Si from the second set that has been split from it, and reports both of these sets as being newly formed by the refinement operation.

[Changelog](./CHANGELOG.md)

## API

### `<T>() => (newPartitionCandidate?: Iterable<T>) => Iterable<Iterable<T>>`

Creates a refiner function.

Pass to it new candidates for refinement.

Returns refined partition.

### Example

```typescript
import refiner from '../src';

const refineNext = refiner();
refineNext(['a', 'b', 'c']);
refineNext(['b', 'c', 'e']);
console.log(refineNext()); // Iterable of Iterables: ((a), (b, c), (e))
```

# License

[MIT](https://github.com/kshutkin/slimlib/blob/main/LICENSE)
