---
'@slimlib/store': patch
---

Prevent effect cleanup from running more than once when its disposer is called repeatedly or its owning scope is disposed after manual disposal.
