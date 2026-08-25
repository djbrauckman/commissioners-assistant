# Database setup (Supabase)

The dues tracker and history/stats pages are backed by a small Postgres
database via Supabase, accessed through Vercel serverless functions in
`api/`. The frontend itself is still plain static HTML/JS — this only adds
a thin backend layer behind it. None of the account-side steps below can be
done from the repo itself; they need your own Supabase and Vercel accounts.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty for this).
2. Open the SQL editor and run everything in [`db/schema.sql`](db/schema.sql). This creates two tables: `dues_state` and `season_cache`.
3. In Project Settings → API, note down:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not the `anon` key — the service role key bypasses row-level security and must never be exposed to the browser) → this is `SUPABASE_SERVICE_ROLE_KEY`

## 2. Pick a shared secret

Generate any random string (e.g. `openssl rand -hex 24`) — this is `API_SHARED_SECRET`. It's a casual deterrent guarding the `/api/*` endpoints, not real security (this repo is public, so treat it as a "please don't poke around" sign, not a lock). What it actually protects is your Supabase service role key, which never leaves the server.

## 3. Set Vercel environment variables

In the Vercel project's Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
| `API_SHARED_SECRET` | from step 2 |

## 4. Put the shared secret in the frontend

Open [`js/db-client.js`](js/db-client.js) and replace `REPLACE_WITH_YOUR_SHARED_SECRET` with the same value you used for `API_SHARED_SECRET` in step 3. This is the one piece of the secret that does need to ship to the browser, since the browser is what calls `/api/*` — see the note in that file for why this is a deterrent rather than a lock.

## 5. Redeploy

Push to `main` (or trigger a redeploy in Vercel) so the new env vars and `api/` functions take effect. Vercel auto-detects the `api/` folder and `package.json` and provisions serverless functions for it — no extra config needed.

## Local development

The old `python3 -m http.server` setup only serves static files — it can't run the `api/` functions. To test the database-backed pages locally:

```bash
npm install -g vercel   # one-time
npm install              # installs @supabase/supabase-js for the api/ functions
vercel dev
```

`vercel dev` needs the same three env vars from step 3 — either `vercel env pull` after linking the project, or create a `.env.local` (already gitignored... check first, add `.env.local` to `.gitignore` if it isn't) with the same three variables.

## What's cached vs. what's live

- **`dues_state`** — the actual source of truth for who's paid and the payout split. Every toggle/edit writes through immediately.
- **`season_cache`** — a pure cache of expensive-to-recompute, fully Sleeper-derived results (`history.js`'s per-season standings/bracket/H2H, `stats.js`'s per-manager weekly breakdown). Only ever written for seasons Sleeper reports as `status: "complete"` — the current in-progress season is always fetched live and never cached, since it isn't done changing. If a completed season's cache ever looks wrong, just delete that row from `season_cache` in Supabase and the next page load will recompute and re-cache it.
