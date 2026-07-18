# Vendored skills

These skills are vendored (copied) from **Matt Pocock's skills** repo so that
Claude Code sessions — including cloud instances — can run the wayfinding and
engineering workflow without a separate install step.

- Source: https://github.com/mattpocock/skills
- Vendored from commit: `9603c1cc8118d08bc1b3bf34cf714f62178dea3b`
- License: MIT (see `LICENSE` in this directory)

## What's here

The engineering workflow set plus `grilling`. Entry point for this repo is
`wayfinder` (charts the planning map on GitHub Issues). It invokes
`grilling`, `domain-modeling`, `research`, `prototype`, `to-spec`, and
`to-tickets`; `setup-matt-pocock-skills` scaffolds the tracker config in
`docs/agents/`.

## Updating

Re-copy the desired skill folders from a fresh clone of the source repo and
bump the commit hash above. These are a read-only vendored snapshot — edit the
upstream repo, not these copies, unless you intend to fork.
