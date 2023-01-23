
export default function<T>() {
    const processed = new Set<Set<T>>();

    return (newPartitionCandidate?: Iterable<T>) => {
        if (newPartitionCandidate) {
            const intersections = new Map<Set<T>, Set<T>>();
            for (const element of newPartitionCandidate) {
                for (const partitionItem of processed) {
                    if (partitionItem.has(element)) {
                        let intersection: Set<T> | undefined = intersections.get(partitionItem);
                        if (intersection === undefined) {
                            intersection = new Set<T>();
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
        return processed as Iterable<Iterable<T>>;
    };
}
