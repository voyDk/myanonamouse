# myanonamouse

Automates MyAnonamouse bonus-point management with this order:
1. Donate to Millionaire's Club (if not already donated).
2. Extend VIP.
3. Spend remaining points on upload credit.

The script runs in `dry-run` mode by default and only performs real spending with `--apply`.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Add your credentials in `.env`:

```env
MAM_EMAIL=you@example.com
MAM_PASSWORD=your_password
```

## Run

Dry-run (recommended first):

```bash
npm run mam:check
```

Real spend mode:

```bash
npm run mam:apply
```

Visible browser mode for debugging:

```bash
npm run mam:headed
```

## Key config

- `MAM_BONUS_THRESHOLD`: spend when bonus is at or above this value (default `98000`).
- `MAM_BONUS_TARGET`: try to bring bonus down toward this value (default `90000`).
- `MAM_DONATE_POINTS`: donation amount for Millionaire's Club step (default `2000`).
- `MAM_MIN_UPLOAD_SPEND`: minimum leftover before trying upload-credit step (default `500`).

## Notes

- Debug artifacts (HTML, screenshot, form discovery JSON) are saved under `debug/` after each run.
- If page structure changes, run `mam:headed` and inspect the latest `debug/*/forms.json` for selector tuning.
