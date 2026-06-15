---
"@slimlib/jsx": minor
---

added RootProvider, which provides a context value only when no ancestor scope already provides it; the factory runs lazily and at most once, only when this provider actually becomes the root for the context
