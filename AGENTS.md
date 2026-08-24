# Project Conventions

Review README.md to understand project overview and monorepo structure.

## Package Management

This is a **pnpm monorepo** using pnpm workspaces.

- **Do not** use `npm`, `yarn`, or `bun` directly.
- **Always** prefer `pnpm dlx` and `pnpm exec` over `npx`.

## Naming and Nomenclature

All functions, state, and values use **snake_case**.

Fall back to matching nomenclature (camelCase, PascalCase) **only** when interfacing with:
- Standard libraries (Node.js)
- Web standards (client/browser APIs)
- External packages or libraries

Examples of acceptable exceptions: `React.useEffect`, `encodeURIComponent()`, `prisma.user.findMany()`.

## Validating Work

Run these commands to validate changes:

| Command | Description |
|---|---|
| `pnpm run build` | Build across all packages |
| `pnpm run check` | Lint and formatting checks across all packages |
| `pnpm run check:fix` | **Preferred** — runs checks and auto-fixes where possible |
