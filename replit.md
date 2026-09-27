# Movie Show Investing

A filmmaker–investor matching MVP that tests non-binding interest in films and shows without collecting money.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Follow `DECISIONS.md` for locked product rules and `PLAN.md` for phase boundaries and open choices. The existing Express/PostgreSQL stack replaces the guides' Flask examples; preserve their intended behavior without adding a second backend.
- The current Phase 1 allocation uses net project receipts proportionally for investor payback and the platform fee; do not reuse guide copy saying all receipts go to investors. Do not assume a post-payback residual allocation.
- A “private” project is unlisted but visible to anyone with its link. Do not describe it as access-controlled.

## Product

- First test: filmmaker submissions and approved project pages; investor pledges launch later. All pledges are non-binding and no money is collected.

## User preferences

- Keep the MVP lean, straightforward to build and test in the market, and easy for users to understand. Build only the assigned phase; do not add an unrequested feature to solve a design issue.
- If the logic, numbers, copy, or user journey does not make sense, explain the user impact and recommend the smallest fix. Get approval before changing locked product terms; keep undecided items explicitly open.
- Legal review has already been handled by the owner. Do not reopen it as a generic blocker.

## Gotchas

- Visual Guide examples and admin counts are not real launch data. Treat checks depending on a later phase as blocked until that phase, not as a reason to build ahead.
- The first market launch is after Phase 6 and the investor launch is after Phase 8; earlier phase placeholders must not be shown as working features to users.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Product source of truth: `DECISIONS.md` and `PLAN.md`. Reference material: the three uploaded Movie Show Investing PDFs in `.conversation/attached_assets/`.
