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

Edge Functions deploy with `supabase functions deploy <name>`.

Neither is wired into CI yet. Doing that is deliberate: the schema does not exist yet, and an
automatic `db push` against production is a decision to make once there is a schema worth
protecting.

## Before real traffic

Supabase's built-in magic-link email sender is rate-limited to the point of being unusable for real
signups. Plug in a free-tier transactional provider (Resend or similar) under Authentication →
Emails before launch. A fast-follow, not a v1 blocker.
