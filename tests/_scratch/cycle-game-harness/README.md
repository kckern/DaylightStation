# Cycle game visual harness

Renders the presentational CycleGame components (lobby, staging, countdown,
race screen, menu, toast, results, pace delta) in a real browser with no
backend. Never starts `__backend/index.js` and never calls `/api`.

`vite.harness.config.mjs` calls the app's own `frontend/vite.config.js` and
reuses its plugins, SCSS options, aliases and `define`. It only adds a no-op
logger (no WebSocket), a loopback-only dev server, and a middleware that
answers `/api/v1/static/img/{users,equipment}/*` with generated SVG. Any other
`/api/*` request returns 404, which fails the screenshot run.

Run from the repo (or worktree) root:

```bash
# 1. frontend-only server on 127.0.0.1 (override with HARNESS_PORT)
node_modules/.bin/vite --config tests/_scratch/cycle-game-harness/vite.harness.config.mjs

# 2. in another shell: screenshot every scene at 1920x1080
BASE_URL=http://127.0.0.1:5199 node tests/_scratch/shoot-cycle-game.mjs
```

PNGs land in `tests/_scratch/out/cycle-game/` (gitignored). `SCENES=a,b` limits
the run. Open one scene by hand at `http://127.0.0.1:5199/?scene=<name>`.
Stop the server when done (`lsof -i :5199` should print nothing).

Scene fixtures live in `scenes.jsx`. A scene is ready when `<body>` gets
`data-harness-ready`.
