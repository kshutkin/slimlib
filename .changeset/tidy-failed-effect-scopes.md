---
'@slimlib/store': patch
---

Remove failed eager effects from their owning scope so their callbacks and captured objects can be collected before the scope is disposed.
