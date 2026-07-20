# Queens

A daily Queens logic puzzle: place one queen per row, per column and per **region**, with no two
queens touching — not even diagonally. One global daily, rolling over at midnight `Europe/Dublin`,
with history, streaks, and global + friends leaderboards.

SvelteKit + TypeScript on Vercel, Supabase for Postgres, Auth, RLS and Edge Functions.

The whole build is specified in [issue #18](https://github.com/fiachramcv90/queens-puzzle-game/issues/18).

## Domain language

Used consistently in code, tests, commits and UI:

| Term           | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| **region**     | A coloured area of the board. Exactly one queen belongs in each. |
| **queen**      | A placed piece. One per row, column and region.                  |
| **mark (X)**   | The player's own notation for a cell they have ruled out.        |
| **the daily**  | Today's puzzle. One globally, the same for every player.         |
| **the pool**   | The precomputed puzzles waiting to be scheduled.                 |
| **rollover**   | The moment the daily flips — midnight `Europe/Dublin`.           |
| **solve time** | Server-measured wall clock from `start` to `submit`.             |
| **streak**     | Consecutive days the daily was solved.                           |

## Prerequisites

- **Node 24** — the version CI and the Vercel runtime use. `.nvmrc` pins it; `nvm use` picks it up.
- **Docker**, running — the local Supabase stack is containers.
- **Supabase CLI** — `brew install supabase/tap/supabase`.

## Local setup

```sh
npm install
supabase start          # first run pulls images; a few minutes
cp .env.example .env    # then paste in the keys supabase start printed
npm run dev
```

The app serves on <http://localhost:5173>. `supabase start` prints the API URL and keys on startup;
`supabase status` reprints them at any time. The local keys are the same shared defaults on every
machine and are worthless outside your laptop — but `.env` is gitignored regardless.

`supabase stop` shuts the stack down; local database contents survive.

## Environment variables

| Variable                          | Where it lives                                               |
| --------------------------------- | ------------------------------------------------------------ |
| `PUBLIC_SUPABASE_URL`             | Client and server. Public.                                   |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client and server. Public by design — RLS protects the data. |
| `SUPABASE_SECRET_KEY`             | Server only, and a GitHub Actions secret. Never the client.  |

The secret key bypasses RLS completely. Two mechanisms keep it out of the browser bundle, and both
are load-bearing: it is read only from [`src/lib/server/supabase-env.ts`](src/lib/server/supabase-env.ts),
which SvelteKit refuses to import into client-reachable code, and it is read through
`$env/dynamic/private`, which refuses to expose anything without a `PUBLIC_` prefix. Adding a
`PUBLIC_` prefix to it would defeat both at once — don't.

Supabase names these the **publishable** key (`sb_publishable_…`) and the **secret** key
(`sb_secret_…`). The build spec calls them by their older names, the **anon** key and the
**`service_role`** key — same two roles either way.

## Scripts

| Script               | What it does                          |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Dev server on <http://localhost:5173> |
| `npm run build`      | Production build (Vercel adapter)     |
| `npm run preview`    | Serve the production build locally    |
| `npm run typecheck`  | `svelte-check` across the app         |
| `npm run lint`       | Prettier check + ESLint               |
| `npm run format`     | Prettier write                        |
| `npm run test`       | Vitest, once                          |
| `npm run test:watch` | Vitest, watching                      |

CI runs `typecheck`, `lint` and `test` on every push to `main` and every pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Tests

Unit tests sit beside the code they cover as `*.test.ts` and run under Vitest.
[fast-check](https://fast-check.dev) is available for property-based tests — the solver core needs
it, because "every generated board has exactly one solution" is a property over thousands of seeds,
not three hand-written boards.

The build spec names two testing seams and only two: the solver core as a pure library, and the
Edge Function HTTP contract against a local Supabase with real RLS.

## Supabase

- [`supabase/migrations/`](supabase/migrations/) — schema, one timestamped `.sql` per change.
  `supabase migration new <name>` creates one; `supabase db reset` replays them all locally.
  Never edit a migration that has already been applied to a deployed database.
- [`supabase/functions/`](supabase/functions/) — Edge Functions, running on Deno.
  `supabase functions serve <name>` runs one locally. They are checked by the Supabase CLI, so the
  app's ESLint and TypeScript configs deliberately skip this directory.

Storage and the local analytics stack are disabled in [`supabase/config.toml`](supabase/config.toml):
the app stores no files and nothing in development reads the logs.

## Configuration

Operational numbers that are guesses until there is real traffic — rate limits, retention windows,
the pool horizon — live in [`src/lib/config/`](src/lib/config/index.ts), not inline at their call
sites. Rules, by contrast, are code: the adjacency definition and the ranked-play filter are not
tunable and do not belong there.

## Deployment

See [docs/deployment.md](docs/deployment.md).
