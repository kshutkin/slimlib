---
"@slimlib/store": major
---

Complete rewrite with new reactive primitives API:

- `state()` replaces `createStore()` for creating reactive proxies
- `effect()` for reactive subscriptions (replaces callback-based subscriptions)
- `computed()` for lazy, cached derived values
- `signal()` for simple reactive values
- `flushEffects()` for synchronous effect execution
- `setScheduler()` for custom scheduling
- `untracked()` to read values without tracking
- Automatic batching of synchronous updates
- Fine-grained dependency tracking
- Liveliness memory management for computeds
- Diamond problem solved (effects run once per batch)
- ESM only, removed CJS and UMD builds
