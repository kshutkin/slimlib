---
"@slimlib/store": patch
---

Clarify that callers should keep and call the disposer for effects created outside a scope. A reachable source can keep an effect subscribed after its disposer is dropped.
