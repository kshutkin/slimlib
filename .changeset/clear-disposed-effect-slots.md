---
'@slimlib/store': patch
---

Remove manually disposed effects from their owning scope so their callbacks and captured objects can be collected while the scope is still alive.
