---
"@slimlib/injector": minor
---

Changed from default export to named export. Import using `{ createInject }` instead of the default import.

**Before:**

```js
import createInject from "@slimlib/injector";
```

**After:**

```js
import { createInject } from "@slimlib/injector";
```

Added `createInjectAnnotated` function for minification-safe dependency injection using AngularJS-style array annotation.

```js
import { createInjectAnnotated } from "@slimlib/injector";

const inject = createInjectAnnotated();

inject([
  "$provide",
  ($provide) => {
    $provide("config", { url: "http://example.com" });
  },
]);

inject([
  "config",
  (config) => {
    console.log(config.url);
  },
]);
```
