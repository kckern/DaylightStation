# API handwritten HTTP 500 classification — 2026-08-28

Scope: production `backend/src/4_api/**/*.mjs`, excluding test modules. Census command:

```sh
rg -n 'status\(500\)' backend/src/4_api -g '*.mjs' -g '!*.test.mjs'
```

Exact total: **83**.

Classification:

- **Intentional** — translation of a semantic failure/capability outcome into the established HTTP contract. This belongs in API.
- **Contract catch** — translation of an unexpected exception into a route-specific legacy envelope. It duplicates centralized error handling structurally, but remains deliberately until its exact public envelope is characterized and centrally reproduced. It is HTTP debt, not domain workflow.

| File | Lines | Count | Classification and reason |
|---|---:|---:|---|
| `v1/handlers/journalist/morning.mjs` | 35 | 1 | Contract catch: morning export failure envelope. |
| `v1/middleware/createDevProxy.mjs` | 9 | 1 | Intentional: shared `LOCAL_DEV_HOST` capability/configuration failure translator. |
| `v1/routers/admin/content.mjs` | 65, 86, 144, 161, 184, 216, 237, 257 | 8 | Contract catches: operation-specific admin list/item failure envelopes. |
| `v1/routers/admin/eventbus.mjs` | 46, 91 | 2 | Contract catches: history and broadcast failure envelopes. |
| `v1/routers/admin/images.mjs` | 60, 92, 131 | 3 | Contract catches: list, upload, and URL-upload failure envelopes. |
| `v1/routers/admin/media.mjs` | 11, 25, 34 | 3 | Contract catches: source/load and command exception envelopes. |
| `v1/routers/admin/media.mjs` | 21 | 1 | Intentional: semantic media-operation `failed` outcome. |
| `v1/routers/api.mjs` | 254 | 1 | Contract catch: `cannot_list_apps` public envelope. |
| `v1/routers/catalog.mjs` | 11 | 1 | Intentional: semantic `render_unavailable` outcome (all QR fetches failed). |
| `v1/routers/catalog.mjs` | 21 | 1 | Contract catch: catalog generation failure envelope. |
| `v1/routers/chess.mjs` | 121 | 1 | Intentional: semantic `save_failed` outcome. |
| `v1/routers/content.mjs` | 251, 387 | 2 | Contract catches: search/list failure envelopes. |
| `v1/routers/device.mjs` | 210, 229 | 2 | Intentional: dispatch capability unavailable, preserved historical status. |
| `v1/routers/display.mjs` | 69 | 1 | Intentional: semantic display failure outcome. |
| `v1/routers/emulator.mjs` | 157, 177, 199, 222, 249, 271, 313 | 7 | Contract catches: emulator command-specific internal-error envelope. |
| `v1/routers/emulator.mjs` | 264 | 1 | Intentional: provider reports delete as unsupported; historical contract uses 500. |
| `v1/routers/entropy.mjs` | 126 | 1 | Contract catch: entropy refresh failure envelope. |
| `v1/routers/epaper.mjs` | 21, 33 | 2 | Contract catches: render and display failure envelopes. |
| `v1/routers/feed.mjs` | 552 | 1 | Contract catch: feed router's established terminal internal-error envelope. |
| `v1/routers/feedback.mjs` | 31, 40 | 2 | Contract catches: feedback save/list error-message envelopes. |
| `v1/routers/finance.mjs` | 17, 29, 42, 73, 87, 99, 141, 151, 161, 173, 185 | 11 | Contract catches: exact finance operation-specific failure envelopes. |
| `v1/routers/fitness.mjs` | 101, 109, 111 | 3 | Intentional: semantic fingerprint authorization/enroll/delete failure outcomes. |
| `v1/routers/fitness.mjs` | 773 | 1 | Intentional: transcription succeeded but ended-session persistence failed; memo must remain in response. |
| `v1/routers/fitness.mjs` | 832 | 1 | Intentional: handled zone-controller failure body consumed by the client state machine. |
| `v1/routers/fitness.mjs` | 1079 | 1 | Intentional: semantic emergency release scan failure outcome. |
| `v1/routers/health.mjs` | 270, 489, 581, 600, 616 | 5 | Contract catches: established health/nutrition operation-specific envelopes. |
| `v1/routers/language.mjs` | 104 | 1 | Intentional: semantic language operation internal-failure result. |
| `v1/routers/launch.mjs` | 75 | 1 | Contract catch: launch failure message envelope. |
| `v1/routers/life/log.mjs` | 36, 50, 62, 78 | 4 | Contract catches: range/scope/category/day legacy message envelopes. |
| `v1/routers/lifelog.mjs` | 53, 85 | 2 | Contract catches: lifelog aggregate/weight message envelopes. |
| `v1/routers/localContent.mjs` | 7 | 1 | Intentional: shared unconfigured local-content capability translator. |
| `v1/routers/qrcode.mjs` | 16 | 1 | Contract catch: QR generation failure envelope. |
| `v1/routers/scheduling.mjs` | 80 | 1 | Contract catch: scheduling command message envelope. |
| `v1/routers/school.mjs` | 151 | 1 | Contract catch: final School wrapper fallback after specific error mappings. |
| `v1/routers/screens.mjs` | 82 | 1 | Contract catch: screen command message envelope. |
| `v1/routers/tts.mjs` | 155, 161 | 2 | Contract catches: streaming and synthesis failure envelopes. |
| `v1/routers/weekly-review.mjs` | 24, 72, 107, 137 | 4 | Contract catches: route-specific `{ok:false,error}` envelopes. |

Totals: **16 intentional semantic/capability translations + 67 contract catches = 83**.

None of these occurrences performs persistence, provider selection, business authorization, allocation, or multi-service orchestration. The 67 contract catches are candidates for a future centralized translator only if characterization tests first lock their exact status/body behavior; deleting them outright would change the API contract.
