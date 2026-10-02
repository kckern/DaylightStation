# AI structured wire layer — rollout record

Reference: `docs/reference/core/ai-structured-wire-layer.md`. Spec/plan:
`docs/superpowers/specs|plans/2026-10-01-ai-structured-wire-layer*`.

## Status (2026-10-02)

- Deployed inert (`ai.wire.config {"mode":"off","sample":1}` at boot, build `ab3e38f1f`).
- Offline A/B (`cli/ai-wire-ab.cli.mjs`, 20 real food descriptions × 3 runs,
  gpt-4.1): **FAIL** — the layer stays `off`.

## A/B result

| Path | Calls | Avg completion tokens | Avg latency |
|---|---|---|---|
| JSON (baseline) | 60 | 337 | 1.85 s |
| TOON reply (decoded or not) | 60 | 132 | 1.12 s |
| JSON re-ask after TOON decode failure | 54 | 353 | 1.86 s |

Verdict reasons: fallback 54/60 (> 5%); kcal within JSON spread for 15/20
texts; name overlap for 16/20 texts. When a TOON reply is used it is ~61% fewer
output tokens and ~40% faster, but end-to-end the TOON path was slower
(2.8 s mean) because almost every call re-asked.

## Why TOON replies fail to decode (20-reply diagnostic)

| Outcome | Count | Model behaviour |
|---|---|---|
| ok | 5 | — |
| toon-parse | 9 | table rows written without the 2-space indent |
| wrong-delimiter | 5 | header copied the primer's placeholder literally (`name[4]{…}`) |
| toon-parse | 1 | `dish` column name replaced by a stray tab in the header |

The strict decoder is doing its job: every failure fell back to JSON and no
wrong data was saved. The failure is generation fidelity, not decoding.

## Ledger query used

Rows `app: ai-wire-ab, feature: cli`, grouped by `wire`, averaging
`completionTokens` and `durationMs` over `data/system/history/ai-usage/2026-10*.jsonl`.
