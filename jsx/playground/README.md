# @slimlib/jsx playground

A local dev playground showing the core JSX features against the in-repo source. Edits to `../src/*` hot-reload here via Vite aliases.

```bash
pnpm play          # from jsx/
# or
pnpm --filter @slimlib/jsx play
```

This opens http://localhost:5180 with a counter, conditional, reactive text input, and keyed `forEach` todo list.

## Files

- `index.html` — entry HTML
- `main.jsx` — sample app
- `vite.config.mjs` — Vite config wiring esbuild's automatic JSX runtime to `@slimlib/jsx` and aliasing the package names to the local sources (so you don't need to `pnpm build` between edits)
