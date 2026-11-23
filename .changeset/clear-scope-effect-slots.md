---
"@slimlib/store": patch
---

Clear a scope's effect registrations together after disposing its effects, avoiding a separate slot write for each effect during scope teardown.
