---
"@slimlib/store": minor
---

Track effects and child scopes in one circular doubly linked list. Manual disposal removes registrations immediately, so scope teardown only visits live entries.

Effects and child scopes now clean up in their shared registration order. A parent effect registered before a child scope cleans up first. The scope runs its `onDispose` callbacks after draining the list.
