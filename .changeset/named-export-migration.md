---
"@slimlib/get-parameter-names": minor
---

Changed from default export to named export. Import using `{ getParameterNames }` instead of the default import.

**Before:**
```js
import getParameterNames from '@slimlib/get-parameter-names';
```

**After:**
```js
import { getParameterNames } from '@slimlib/get-parameter-names';
```
