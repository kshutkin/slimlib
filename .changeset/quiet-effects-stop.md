---
'@slimlib/store': patch
---

Dispose eager effects when their initial callback throws, removing subscriptions and preventing queued or future runs before rethrowing the original error.
