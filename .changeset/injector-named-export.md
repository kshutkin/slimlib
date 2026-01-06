---
"@slimlib/injector": minor
---

Changed from default export to named export. Import using `{ createInject }` instead of the default import.

**Before:**
```js
import createInject from '@slimlib/injector';
```

**After:**
```js
import { createInject } from '@slimlib/injector';
```
