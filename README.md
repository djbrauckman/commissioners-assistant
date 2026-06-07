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
├── index.html          # Entry point
├── css/
│   └── styles.css      # All styles
└── js/
    ├── divisions.js    # Division randomizer (ported from Python)
    ├── schedule.js     # Schedule generation + rivalry week logic
    ├── sleeper.js      # Sleeper API integration
    └── app.js          # UI wiring
```

## Running Locally

No build step needed — pure HTML/CSS/JS.

```bash
# Option 1: Python simple server
python3 -m http.server 8080

# Option 2: Node
npx serve .
```

Then open `http://localhost:8080`.

> **Note:** The Sleeper API (`api.sleeper.app`) requires CORS-enabled requests. Running from a local server (not `file://`) is required for the Sleeper integration to work.

## Deploying

### Vercel (recommended)
```bash
npm i -g vercel
vercel
```

### Netlify
Drag the `fantasy-commissioner/` folder into [app.netlify.com/drop](https://app.netlify.com/drop).

### GitHub Pages
Push to a repo, go to Settings → Pages → Deploy from branch (`main`, `/ (root)`).

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
