---
'@slimlib/store': patch
---

Reuse the same comparator when sorting out-of-order effect batches to avoid allocating a function on each sorted flush.
