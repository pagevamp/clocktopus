---
name: verify
description: Run build and lint checks to verify the project compiles and passes linting.
---

Run the following commands in sequence and report results:

1. `bun run build` — TypeScript compilation
2. `bun run lint` — ESLint + Prettier checks

If any step fails, report the errors clearly and suggest fixes. Only proceed to the next step if the previous one succeeds.
