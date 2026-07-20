# Queens Puzzle Game

A Queens logic puzzle game — one queen per row, column, and colored region; no two queens adjacent (including diagonally). Web app (SvelteKit + Supabase), with a daily puzzle, history/streaks, and global + friends leaderboards.

Foundation and MVP scope are being charted with the `wayfinder` skill. See the map in the issue tracker.

## Working in this repo

`README.md` covers local setup, scripts and env vars; `docs/deployment.md` covers Vercel and
Supabase. The build spec every slice implements is GitHub issue **#18**.

Two conventions worth stating up front, because breaking them is quiet:

- **Domain language is fixed** — _region_, _queen_, _mark (X)_, _the daily_, _the pool_, _rollover_,
  _solve time_, _streak_. Use those words in code, tests and UI; don't drift to synonyms.
- **The `service_role` key never reaches the client.** How that is enforced is documented once, in
  `src/lib/server/supabase-env.ts`. Read it before touching anything that handles keys.

Tunable operational numbers (rate limits, retention, pool horizon) belong in `src/lib/config/`, not
inline. Rules — adjacency, the ranked-play filter — are code, not config.

Before pushing: `npm run typecheck && npm run lint && npm run test`.

## Skills (vendored, cloud-ready)

The engineering workflow skills are vendored under `.claude/skills/` (from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT — see
`.claude/skills/README.md`). They're checked in so any Claude Code session,
including a cloud instance, can run these planning sessions with no separate
install. Entry point: **`/wayfinder`** with the map URL.

## Agent skills

### Issue tracker

Issues (including the wayfinder map and its decision tickets) live in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Wayfinder map

The planning map is GitHub issue **#1** (label `wayfinder:map`); its decision tickets are child issues (#3–#16). To continue, invoke `/wayfinder` with the map URL.
