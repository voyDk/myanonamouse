# myanonamouse

Nx monorepo using Bun with:
- React + TypeScript
- Vite
- strict TypeScript settings
- Bulletproof-style folder layout

## Tooling

```bash
bun install
```

## React app

Run the UI:

```bash
bun run dev
```

When running the Vite dev server, the UI fetches live data from `/api/snapshot`, which executes the Playwright automation script in snapshot mode.

Other tasks:

```bash
bun run lint
bun run test
bun run build
```

## Frontend architecture

The React app lives in `web/src` and follows a Bulletproof-inspired structure:

```text
web/src
  app/          # providers + router entry
  config/       # env parsing and app config
  features/     # feature slices (bonus, spending-plan)
  pages/        # route-level pages
  shared/       # shared UI, layouts, utilities
```

## Automation script

Browser automation for MyAnonamouse spending rules remains available:

```bash
bun run mam:check   # dry-run
bun run mam:apply   # real spend
bun run mam:headed  # visible browser
bun run mam:snapshot # JSON snapshot used by the React UI
```

CLI control for direct operations:

```bash
bun run mam:cli -- --help
bun run mam:cli -- status --json
bun run mam:cli -- donate --amount 2000 --apply
bun run mam:cli -- vip --weeks 8 --apply
bun run mam:cli -- upload --gb 20 --apply
```

CLI commands are dry-run by default. Add `--apply` (or `--yes`) to execute.

Order used by the script:
1. Millionaire's Club donation
2. VIP extension
3. Upload credit exchange

## Environment

Create `.env` from `.env.example` and set credentials:

```env
MAM_EMAIL=you@example.com
MAM_PASSWORD=your_password
```
