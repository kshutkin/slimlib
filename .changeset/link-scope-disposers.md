---
"@slimlib/store": minor
---

Track effects and child scopes in one circular doubly linked list. Manual disposal unlinks registrations immediately. Registry storage and teardown scans stay proportional to live registrations as long-lived scopes add and dispose effects and child scopes.

Effects and child scopes now clean up in their shared registration order. A parent effect registered before a child scope cleans up first. The scope runs its `onDispose` callbacks after draining the list.
