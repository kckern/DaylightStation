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

## A/B #2 (2026-10-02, build 9a83383d8): primer fix + flush-left rows + scalar checks

Same 20 texts × 3 runs, gpt-4.1. **FAIL** — layer stays `off`.

| Path | Calls | Avg completion tokens | Avg latency |
|---|---|---|---|
| JSON (baseline) | 60 | 338 | 2.04 s |
| TOON reply | 60 | 136 | 1.28 s |
| JSON re-ask after TOON failure | 6 | 613 | 3.04 s |

End-to-end TOON path: 1.59 s mean vs 2.04 s JSON. Fallbacks dropped 54/60 → 6/60.

Verdict reasons: fallback 6/60 (> 5%); kcal within JSON spread ±15% for
12/20 texts (needs 18); TOON food names overlapped JSON's for 17/20 texts (needs 18).
Open question: whether the kcal/name gaps are the TOON format or ordinary
model variance against a 3-run JSON spread.

## A/B #3 (2026-10-02, build a75e8973a): 20 texts × 5 runs, JSON control added

**FAIL** — layer stays `off`.

| Rate (per text, vs the JSON runs' spread) | TOON | JSON control |
|---|---|---|
| item count matches | 90% | 95% |
| kcal within ±15% | **60%** | 85% |
| food names overlap | 85% | 75% |

Fallbacks 6/100 (limit 5%). TOON mean 1.50 s vs JSON 2.16 s; replies ~35% smaller.

Conclusion: the decode is now reliable enough to measure, and the remaining gap
is not noise: with the same prompt, the model's calorie estimates differ when it
answers in a TOON table (25 points below JSON's own consistency). Item lists and
names are equivalent. Enabling it would change logged nutrition, so it stays off.
Options if revisited: try a model that follows TOON better, or a compact-JSON
reply (columns once, rows as arrays) instead of TOON.
