---
'@slimlib/store': patch
---

Unsubscribe disposed effects from their reactive sources even when their final cleanup throws, so live sources can release the disposed effects.
