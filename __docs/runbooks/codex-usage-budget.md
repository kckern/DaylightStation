# Codex weekly usage gate

Run `node cli/codex-usage.cli.mjs check --json` before delegating work, after each batch, and every minute while work is active. It reads live Codex app-server rate limits; it does not start a model turn, inspect local session history, read credentials, alter configuration, or consume reset credits.

The gate measures only the `codex` 10,080-minute window. It takes the largest matching primary or secondary `usedPercent`, so token-activity summaries and daily buckets are never treated as a weekly denominator. A missing, malformed, expired, or contradictory weekly response is `STOP` (exit 3), as is a service failure. The hard stop is inclusive at 50% (exit 2); 48% through below 50% is `WARNING` but exits 0 so the caller can finish its current shell step without starting new work.

At `WARNING`, do not delegate or start new work: reserve capacity. At `STOP` or an unavailable result, stop active agents where the host can do so and report the failed objective within budget. This CLI only terminates the app-server child it starts; it cannot cancel the host or in-flight model work. Do not resume automatically after a reset or any credit change—obtain user approval first.

`status` is the default and additionally requests the optional account token-activity summary. That summary can be unavailable or lagged; it never changes the gate decision. Use `--json` for a compact machine-readable result with the checked time, weekly percentage, reset, fixed thresholds, decision, and safe reason.

Protocol reference: <https://learn.chatgpt.com/docs/app-server>.
