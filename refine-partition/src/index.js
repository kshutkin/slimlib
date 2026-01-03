/**
 * @template T
 * @returns {(newPartitionCandidate?: Iterable<T>) => Iterable<Iterable<T>>}
 */
export default function () {
    /** @type {Set<Set<T>>} */
    const processed = new Set();

    return newPartitionCandidate => {
        if (newPartitionCandidate) {
            /** @type {Map<Set<T>, Set<T>>} */
            const intersections = new Map();
            for (const element of newPartitionCandidate) {
                for (const partitionItem of processed) {
                    if (partitionItem.has(element)) {
                        /** @type {Set<T> | undefined} */
                        let intersection = intersections.get(partitionItem);
                        if (intersection === undefined) {
                            intersection = new Set();
                            intersections.set(partitionItem, intersection);
                        }
                        intersection.add(element);
                        partitionItem.delete(element);
                        if (partitionItem.size === 0) {
                            processed.delete(partitionItem);
                        }
                    }
                }
            }
            const newPartitionItem = new Set(newPartitionCandidate);
            for (const intersection of intersections.values()) {
                processed.add(intersection);
                for (const element of intersection) {
                    newPartitionItem.delete(element);
                }
            }
            intersections.clear();
            if (newPartitionItem.size > 0) {
                processed.add(newPartitionItem);
            }
        }
        return /** @type {Iterable<Iterable<T>>} */ (processed);
    };
}
