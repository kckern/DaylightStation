# Loggly CLI Presets

Located next to `loggly-cli.js`. Provides shorthand queries for common diagnostics.

## Prereqs
- Set env vars: `LOGGLY_SUBDOMAIN`, `LOGGLY_API_TOKEN` (or `LOGGLY_TOKEN`).
- Optional: YAML config merging from repo root (`config.app.yml`, `config.secrets.yml`, `config.app-local.yml`).

## Usage
```bash
node scripts/loggly-cli.js [options]
```
Common options:
- `-f, --from` time (default `-1h`)
- `-u, --until` time (default `now`)
- `-l, --limit` rows (default `50`, presets bump to `100`)
- `--json` raw JSON output

### Presets
- `--stalls`   — Stall lifecycle diagnostics.
- `--overlay`  — Overlay visibility/summary noise.
- `--startup`  — Startup watchdog + startup signals (extends window to 2h by default).

Examples:
```bash
# Stall lifecycle last 30m
node scripts/loggly-cli.js --stalls -f -30m

# Overlay noise last 2h, newest first, raw JSON
node scripts/loggly-cli.js --overlay -f -2h --json

# Startup watchdog timeline with widened window
node scripts/loggly-cli.js --startup -f -2h -l 200
```

## Output behavior
- Presets print compact columnar rows when log lines are JSON (fall back to raw message otherwise).
- `--json` bypasses formatting and prints the events array.

## Preset columns
- `--stalls`: ts, event, stallId, waitKey, seconds, bufferMs, ready, net, progress, frame, durationMs.
- `--overlay`: ts, event, waitKey, label, visible, active, reasons, severity.
- `--startup`: ts, event, waitKey, state, reason, attempts, elapsedMs, timeoutMs.

## Tips
- Combine with `-q` to further filter within a preset (e.g., `--stalls -q "stall-recovered"`).
- Increase `-l` or adjust `-f/--until` for larger windows.
- If you hit 401/403, ensure you are using an API Token (not an Input Token).
