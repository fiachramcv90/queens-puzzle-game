# Deployment

## Where things live

- **Vercel project** — <https://vercel.com/fiachramcv90/queens-puzzle-game>
- **Supabase project** — <https://supabase.com/dashboard/project/lexraaeqxhrqoekafwqt>

## Vercel

The app builds with [`@sveltejs/adapter-vercel`](https://svelte.dev/docs/kit/adapter-vercel),
configured in [`vite.config.ts`](../vite.config.ts). The runtime is pinned to `nodejs24.x` rather
than inferred from whatever Node the machine happens to be running, so a developer on a newer Node
still builds what production runs.

Vercel detects SvelteKit on its own — there is no `vercel.json` and there should not need to be.
Pushing to `main` deploys production; every pull request gets a preview deployment.

### Environment variables to set in Vercel

Project Settings → Environment Variables. Values come from the Supabase dashboard, Project Settings
→ API keys.

| Variable                          | Environments                     | Scope                                  |
| --------------------------------- | -------------------------------- | -------------------------------------- |
| `PUBLIC_SUPABASE_URL`             | Production, Preview, Development | Exposed to the browser — intended      |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | Exposed to the browser — intended      |
| `SUPABASE_SECRET_KEY`             | Production, Preview              | **Server-side only. Never `PUBLIC_`.** |

Naming that last one with a `PUBLIC_` prefix would ship it to every visitor — see the environment
variables section of the [README](../README.md#environment-variables) for why. If it happens,
rotate the key in the Supabase dashboard.

## GitHub Actions

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs typecheck, lint and tests. It
needs no secrets — nothing in it talks to Supabase.

The offline pool generator, which lands in a later slice, will need `SUPABASE_SECRET_KEY` as a
repository **secret** (Settings → Secrets and variables → Actions). That is the only place in the
repo's automation the key belongs.

## Supabase

Migrations are applied to the hosted project with:

```sh
supabase link --project-ref lexraaeqxhrqoekafwqt
supabase db push
```

Edge Functions deploy with `supabase functions deploy <name>` (the play lifecycle is
`start`, `heartbeat`, `submit`, `reveal`, `assist` and `merge`). They load a bundled copy of the solver and config from
`supabase/functions/_shared/*.bundle.js`, because Deno cannot import `src/lib`. Rebuild the bundles
with `npm run build:edge-bundles` and commit them before deploying — CI fails if the checked-in
bundle has drifted from the source.

Neither is wired into CI yet. Doing that is deliberate: the schema does not exist yet, and an
automatic `db push` against production is a decision to make once there is a schema worth
protecting.

## Operations

### Retention

Two clocks, run daily by [`.github/workflows/retention.yml`](../.github/workflows/retention.yml)
and dispatchable by hand (with a `dry_run` input that reports without deleting):

| What                        | Clock                                | Why                                                                                     |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Unconverted guest play rows | 90 days (`retention.guestPlaysDays`) | A guest who never signed in has no history to protect and no streak that survives them. |
| Move logs                   | 30 days (`retention.moveLogsDays`)   | Forensic data, not gameplay data.                                                       |
| Play rows                   | **kept forever**                     | History and streaks depend on them.                                                     |

They are **two independent jobs**, and must stay that way. `purge_guest_plays` cannot touch a row
with a `user_id`, so a merged account's history is unreachable from it by construction rather than
by care; `purge_move_logs` deletes only from `play_move_logs`. Neither can reach the other's data.
That separation is the reason `play_move_logs` is its own table.

### The `unverified` alarm

A replay mismatch flags a play `unverified`. **A spike means "suspect a solver-core deploy skew
first", not "suspect a cheating wave"** — board legality is checked directly against `region_map`
and cannot skew, so a legal final board always counts; a mismatch costs only what replay provided.

The same daily workflow reports `unverified_rate(14)` — a per-day rate with the `generator_version`
and move-log format versions in play on each day beside it. Those versions are how you tell the two
apart: a spike that begins on the day a version changed is a deploy skew.

Over 5% on a day with at least 20 completed plays emits a `::warning::` and **fails the run**, so it
shows up red in the Actions list rather than as a line buried in a log. Tune the threshold with the
`UNVERIFIED_ALARM_PCT` environment variable.

Investigate with:

```sh
npm run retention -- --dry-run   # reports the rate, deletes nothing
```

## Before real traffic

**Launch gate.** Supabase's built-in magic-link email sender is rate-limited to the point of being
unusable for real signups. Plug in a free-tier transactional provider (Resend or similar) under
Authentication → Emails **before launch**. A fast-follow rather than a v1 blocker — but it is a
gate that should be closed deliberately, not rediscovered under load when signups start silently
failing.
