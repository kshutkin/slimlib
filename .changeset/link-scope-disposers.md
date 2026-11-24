---
"@slimlib/store": minor
---

Track effects and child scopes in one circular doubly linked list. Manual disposal unlinks registrations immediately. Registry storage and teardown scans stay proportional to live registrations as long-lived scopes add and dispose effects and child scopes.

Effects and child scopes now clean up in reverse registration order from the same list. The scope then runs its `onDispose` callbacks in registration order.
