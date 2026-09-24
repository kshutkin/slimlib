# Development Manifesto

We develop Slimlib with the following priorities, in order:

1. **Correctness comes first.** A library is not usable if its behaviour is incorrect. Every design decision and optimisation must preserve correctness.

2. **Developer experience comes next.** The library should be intuitive to use and behave predictably. This priority motivates choices such as the live sources model in `@slimlib/store`.

3. **Performance should stay close to the cutting edge.** We accept slightly slower average performance to preserve correctness and developer experience. We check for deoptimisations and use explicit equality comparisons without type coercion to keep performance predictable.

4. **Size matters.** We make a deliberate effort to keep the library small while preserving the priorities above. Custom mangling and warnings included only in development mode help keep production bundles compact.
