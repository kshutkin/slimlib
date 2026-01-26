# remaining optimizations
- optimize object shape if it is even possible because it deoptimizes the runWithTracking
- should effect remove itself from batched? make a hole and remove disposed (we save on each run a bit)
- nodes that participate in deps / sources as in linked lists + data part?
- scopes - no hidden variables (is it possible?)
- effect - no mixing function + properties
- DepsSet - no attaching property on native Set
