/**
 * @template T
 * @returns {(newPartitionCandidate?: Iterable<T>) => Iterable<Iterable<T>>}
 */
export default function () {
    /** @type {Set<Set<T>>} */
    const processed = new Set();

    return newPartitionCandidate => {
        if (newPartitionCandidate) {
            let remainingElements = new Set(newPartitionCandidate);

            for (const partitionItem of [...processed]) {
                const intersection = partitionItem.intersection(remainingElements);
                if (intersection.size > 0) {
                    // Remove intersection elements from remaining candidate elements
                    remainingElements = remainingElements.difference(intersection);
                    // Only modify processed if partition is partially consumed
                    if (intersection.size < partitionItem.size) {
                        // Partial overlap - split partition into remainder and intersection
                        processed.delete(partitionItem);
                        const remainder = partitionItem.difference(intersection);
                        processed.add(remainder);
                        processed.add(intersection);
                    }
                    // If intersection.size === partitionItem.size, partition is fully consumed
                    // No need to delete/add since partitionItem already contains all intersection elements
                }
            }

            // Add elements that didn't intersect with any existing partition
            if (remainingElements.size > 0) {
                processed.add(remainingElements);
            }
        }
        return /** @type {Iterable<Iterable<T>>} */ (processed);
    };
}
