# Fantasy Commissioner Tool

A lightweight, client-side fantasy football commissioner utility.

## Features

- **Division randomizer** — shuffles teams into balanced divisions (re-rollable)
- **Schedule generator** — hand-balanced 13-week template for 10-team/2-division leagues; algorithmic round-robin for other configs
- **Rivalry week** — pulls last season's Sleeper standings and generates a bonus week where each division's seeds face each other (1A vs 1B, 2A vs 2B, etc.)
- **Export** — .txt (matches original format) and .csv

## Project Structure

```
fantasy-commissioner/
├── index.html, stats.html, history.html, dues.html, keepers.html, draft-research.html
├── css/                 # Styles, one file per page plus shared styles.css
├── js/                  # One file (or pair) per page, all vanilla JS
├── api/                 # Vercel serverless functions (dues + season cache), see SETUP.md
├── db/schema.sql         # Supabase schema
└── package.json          # Only for api/'s dependencies — the frontend has no build step
```

## Running Locally

The frontend itself needs no build step — pure HTML/CSS/JS.

```bash
# Static frontend only (dues/history/stats pages will fall back to live
# Sleeper fetches with no caching or persistence — see SETUP.md to wire up
# the database-backed api/ functions with `vercel dev` instead)
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

> **Note:** The Sleeper API (`api.sleeper.app`) requires CORS-enabled requests. Running from a local server (not `file://`) is required for the Sleeper integration to work.

## Database

The dues tracker and the history/stats pages' expensive-to-recompute results are backed by a small Postgres database (Supabase), reached through the serverless functions in `api/`. See [SETUP.md](SETUP.md) for the one-time account setup (Supabase project, schema, Vercel env vars) — required before those pages will persist anything.

## Deploying

### Vercel (recommended)
```bash
npm i -g vercel
vercel
```
Vercel auto-detects `api/` and provisions serverless functions for it alongside the static frontend — no extra config needed, once the env vars from [SETUP.md](SETUP.md) are set.

### Netlify / GitHub Pages
Still work for the static frontend, but `api/` (dues persistence, history/stats caching) needs Vercel-style serverless function support and won't run there without adapting those functions to the target platform's equivalent.

## Sleeper Integration

The tool uses the public [Sleeper API](https://docs.sleeper.com) — no API key required.

- Fetches rosters and users from the specified league ID
- If a prior season year is specified, walks the `previous_league_id` chain to find it
- Ranks teams within each division by: wins (desc) → total fantasy points (desc)
- Maps division ranks across divisions to generate rivalry week matchups

## Roadmap

- [ ] Dues tracker (Step 5)
- [ ] Playoff bracket generator
- [ ] Multi-sport support
- [ ] User accounts / persistent league data
