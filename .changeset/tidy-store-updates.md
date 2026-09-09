---
"@slimlib/store": patch
---

Reduce tracking overhead for repeated reads and skip unnecessary effect and computed re-runs when mixing direct and computed dependencies.

Preserve reentrant source notifications and detach obsolete dependencies during repeated reads. Validate cached computeds before they become live, restore dependency tracking after polling errors, and finish invalidating dependencies before running synchronous effects.
