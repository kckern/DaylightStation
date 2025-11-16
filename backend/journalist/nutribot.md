# Nutribot Technical Reference

## Scope
Frontend: Telegram bots acting as food loggers. Backend: the `backend/journalist` services plus filesystem data stores under `data/journalist`. This document captures the current architecture before refactoring, with emphasis on (1) technical functions, (2) data stores, (3) data flows, (4) interfaces, and (5) core use cases.

---

## 1. Technical Functions
Major modules are listed in call-order from ingress (Telegram webhook) to reporting.

### `foodlog_hook.mjs` — Telegram ingestion & orchestration
| Function | Responsibility | Key collaborators | Notes |
| --- | --- | --- | --- |
| `processFoodLogHook(req, res)` | Primary webhook; normalizes Telegram payloads, derives `chat_id`, routes by payload type (slash command, callback, UPC, photo, text, voice). | `processSlashCommand`, `processButtonpress`, `processImageUrl`, `processImgMsg`, `processUPC`, `processVoice`, `processText`, `assumeOldNutrilogs` | Also injects bot token into global env for downstream code. |
| `processSlashCommand(chat_id, command, message_id)` | Handles `/help`, `/report`, future commands; cleans up original message, tears down report cursor. | `sendMessage`, `removeCurrentReport`, `getPendingUPCNutrilogs`, `loadNutrilogsNeedingListing`, `nutriLogAlreadyListed` | Currently only `/help` implemented; caches last help text per chat to avoid spam. |
| `processButtonpress(body, chat_id)` | Central inline-button router; handles help menu actions, UPC serving selection, accept/discard/revise flow, and adjustment menus. | `getNutrilogByMessageId`, `acceptFoodLog`, `discardFoodLog`, `reviseFoodLog`, `processRevisionButtonpress`, `processUPCServing`, `handle{Review,Report,Coach,ConfirmAll}` | Leading emoji in callback data drives routing. |
| `processUPC(chat_id, upc, message_id, res)` | Barcode ingestion; fetches nutrition via `upcLookup`, shows image + portion buttons, persists interim nutrilog. | `deleteMessage`, `sendImageMessage`, `updateMessageReplyMarkup`, `saveNutrilog`, `getIconAndNoomColorFromItem` (via dynamic import) | Skips report teardown if other UPC items still pending. |
| `processUPCServing(chat_id, message_id, factor, nutrilogItem)` | Applies selected multiplier to UPC nutrients, saves to nutrilist, updates caption, marks nutrilog accepted. | `saveToNutrilistFromUPCResult`, `updateMessage`, `updateNutrilogStatus`, `checkAndGenerateCoachingIfComplete` | Ensures GPT-derived noom color/icon survive to nutrilist rows. |
| `processText / processVoice` | Cleans up originating Telegram message, sends acknowledgement, calls GPT text parser, queues nutrilog, triggers pending processing & coaching check. | `transcribeVoiceMessage`, `processTextInput`, `handlePendingNutrilogs`, `checkAndGenerateCoachingIfComplete` | Handles active revision context via cursor before treating as new entry. |
| `processImgMsg` | Converts Telegram file_id into temporary download URL, deletes original message, forwards to `processImageUrl`, then runs standard pending/coaching pipeline. | `processImageUrl`, `deleteMessage`, `handlePendingNutrilogs` | Validates `file_id` strictly (A–Z, 0–9, `_`, `-`). |
| `processRevisionButtonpress` | Drives multi-level adjustment UI (date → item → factor / move / delete). | `getNutriCursor`, `getNutrilListByDate`, `getNutrilListByID`, `updateNutrilist`, `deleteNuriListById`, `postItemizeFood`, `updateMessage` | Stores state in cursor; supports pagination and moving items between days. |
| `acceptFoodLog / discardFoodLog / reviseFoodLog` | Mutate nutrilog state after inline decisions; `accept` persists accepted status and queues post-processing; `discard` wipes DB + Telegram message; `revise` swaps inline keyboard for free-text prompt and marks nutrilog as `revising`. | `saveNutrilog`, `deleteNutrilog`, `updateMessageReplyMarkup`, `clearPendingCursor`, `handlePendingNutrilogs` | `revise` safeguards single-active revision by restoring previous keyboards. |
| `processRevision`, `processImageRevision`, `processTextRevision` | Applies textual follow-up to existing entry; re-runs GPT models (image or text) with context, stores `status: revised`, updates Telegram message. | `getBase64Url`, `detectFoodFromImage`, `detectFoodFromTextDescription`, `processFoodListData` | Triggers completion check afterwards to potentially regenerate report. |
| `handle{Review,Report,Coach,ConfirmAll}` | Inline help/utility flows; review summarizes pending counts, report triggers `postItemizeFood`, coach force-generates GPT note, confirm-all bulk-accepts. | `assumeOldNutrilogs`, `updateMessageReplyMarkup`, `generateCoachingMessage`, `acceptFoodLog` | Designed so new help options can be slotted without touching webhook. |
| `checkAndGenerateCoachingIfComplete` | Ensures auto-report/coaching only when zero pending UPC + zero unlisted nutrilogs remain. | `assumeOldNutrilogs`, `loadNutrilogsNeedingListing`, `nutriLogAlreadyListed`, `postItemizeFood` | Central gating hook used by UPC, text, image flows. |

### `lib/food.mjs` — GPT interpretation & reporting utilities
| Function | Responsibility | Key collaborators | Notes |
| --- | --- | --- | --- |
| `processFoodListData(jsondata, chat_id, message_id, key?, revision?)` | Formats GPT JSON into human-readable message (sorted by Noom color, portion), attaches inline actions, saves nutrilog + Telegram history. | `updateMessage`, `saveNutrilog`, `saveMessage` | `revision` flag skips new nutrilog creation to avoid dupes. |
| `processImageUrl(url, chat_id)` | Fetches/validates image, extracts OpenGraph fallback if needed, posts placeholder photo, calls GPT vision (`detectFoodFromImage`), then delegates to `processFoodListData`. | `removeCurrentReport`, `sendImageMessage`, `getBase64Url` | Leaves inline keyboard in caption context (key = `caption`). |
| `getBase64Url(imgUrl)` | Resizes remote image to <=800px width, converts to JPEG base64 for GPT. | `node-fetch`, `canvas` | Logs compressed size for debugging. |
| `handlePendingNutrilogs(chat_id)` | Loads nutrilogs needing listing, runs GPT `itemizeFood` per entry, clears/saves nutrilist rows, returns aggregated food items for coaching context. | `loadNutrilogsNeedingListing`, `itemizeFood`, `clearNutrilistByLogUUID`, `saveNutrilist` | Guarantees nutrilist rows mirror nutrilog uuid via `log_uuid`. |
| `postItemizeFood(chat_id, attempt=1)` | High-level report sequence: assume stale nutrilogs, remove keyboards, purge existing report, compute today's items, send “generating” message, call `handlePendingNutrilogs`, render final report image + GPT coaching, store cursor to newly minted report message. | `assumeOldNutrilogs`, `removeCurrentReport`, `getNutrilListByDate`, `handlePendingNutrilogs`, `generateCoachingMessage`, `sendImageMessage`, `setNutriCursor`, `updateMessageReplyMarkup` | Retries up to 3 times if Telegram photo send fails. |
| `removeCurrentReport(chat_id)` | Deletes tracked report message and clears cursor’s `report/adjusting` state. | `getNutriCursor`, `deleteSpecificMessage`, `setNutriCursor` | Called before starting new flow that would conflict with open report. |
| `compileDailyFoodReport(chat_id)` | Aggregates last 7 days of nutrilist rows into macro totals plus emoji’d food list, persists to `nuttidays` store. | `getNutrilListByDate`, `saveNutriDay` | Used by `food_report` image generation and health reports. |
| `loadHealthReportData(req, res)` | Express-style handler that dumps recent nutrilist entries as JSON for front-end preview. | `loadRecentNutriList` | Default chat hard-coded for manual testing. |

### `lib/gpt_food.mjs` — GPT wrappers & coaching logic
| Function | Responsibility | Key collaborators | Notes |
| --- | --- | --- | --- |
| `getInstructions()` | Builds canonical system prompt for GPT food extraction (date/time defaults, Noom color rules, icon whitelist). | `moment-timezone` | Used by both text and vision modes. |
| `getIconAndNoomColorFromItem(item)` | Light-weight GPT call to classify a single string. | `gptCall` | Called from UPC path where only label available. |
| `detectFoodFromImage(imgUrl, extras, attempt)` | Multi-modal GPT request (4o) using `getInstructions`; optional revision context. | `gptCall`, `extractJSON` | Returns `{uuid, food[], date, time}` structure. |
| `detectFoodFromTextDescription(text, extras, attempt)` | Text-only GPT parse with revision context; ensures uuid/time defaults. | `gptCall` | Known bug: uses `today` variable without definition—currently relies on GPT to fill date. |
| `itemizeFood(foodList, img?, attempt)` | Expands array of coarse food items into macro-rich rows, leveraging GPT few-shot prompts; optionally sends supporting photo thumbnail. | `gptCall`, `getBase64Url`, `extractJSON` | Normalizes keys, injects uuid for each item before returning. |
| `generateCoachingMessage(chat_id, newFood, attempt)` | Calculates daily totals, checks thresholds (400/1000/1600 kcal), calls GPT for celebratory or minor feedback, persists to `nutricoach`. | `getNutrilListByDate`, `saveNutriCoach`, `axios` | Falls back to canned strings on GPT failure. |
| `generateCoachingMessageForDailyHealth(maxAttempts, attempt)` | Batch process over `lifelog/health` files to produce long-form daily guidance JSON when data diverges from stored hash. | `loadFile`, `saveFile`, `gptCall`, `md5` | Not hooked into Telegram flow yet, but shares GPT infrastructure. |
| `gptCall(endpoint, payload)` | Centralized OpenAI invocation with rate limiting, logging to disk, and error propagation. | `axios`, `saveFile` | Throws if env `OPENAI_API_KEY` missing or response invalid. |

### `lib/upc.mjs` — Barcode & nutrition providers
| Function | Responsibility | Key collaborators | Notes |
| --- | --- | --- | --- |
| `upcLookup(upc)` | Fan-out sequence: OpenFoodFacts → Edamam → UPCItemDB image search; normalizes serving sizes, nutrients, and imagery. | `openFoodFacts`, `isValidImgUrl`, `fetch` | Returns object that `processUPC` stores inside nutrilog. |
| `openFoodFacts(barcode)` | Primary provider; builds branded image URL (optionally proxied via `nutribot_report_host`), maps nutriments into standard keys, classifies with GPT for noom icon/color, approximates servings/container. | `getIconAndNoomColorFromItem`, `searchImage` | Falls back to generic values when OFF missing data. |
| `makeApiRequest`, `findIdForBarcode`, `getFoodById`, `findFoodByBarcode` | FatSecret REST helpers (HMAC signing) kept for future fallback. | `fetch`, `querystring`, `crypto` | Not wired into `upcLookup` yet. |
| `searchImage(keyword, upc)` | Google Custom Search wrapper returning framed Nutribot CDN URL. | `axios` | Requires `GOOGLE_API_KEY` + `GOOGLE_CSE_ID`. |

### `lib/food_report.mjs` — Report image composer & HTTP endpoints
| Function | Responsibility | Key collaborators | Notes |
| --- | --- | --- | --- |
| Canvas helpers (`drawRect`, `makePieChart`, `makeFoodList`) | Rebuilds former Jimp layouts using `canvas`; sorts foods by calories, applies icons, draws macro bars/pies. | `canvas`, `fs`, `iconPath` env | Comments document font registration requirements. |
| `generateImage(chat_id)` | Calls `handlePendingNutrilogs` to sync data, pulls recent nutrilist via `loadRecentNutriList`, chooses most recent day with data, composes 1080x1400 report. | `moment`, `saveFile`, `handlePendingNutrilogs` | Sets timezone to America/Los_Angeles. |
| `foodReport(req, res)` | Express handler returning generated PNG via HTTP; expects `?chat_id`. | `generateImage` | Sends HTTP 400 when chat_id missing. |
| `scanBarcode(req, res)` | HTTP endpoint to transform UPC into barcode image (uses `bwip-js` inside file). | `generateBarcode` | Useful for debugging physical scanner flows. |
| `canvasImageEndpoint` | Generates stylized hero image for arbitrary label + URL pair. | `canvasImage` | Aligns visual style with Telegram posts. |

### `lib/db.mjs` — Filesystem-backed data access
Core pattern: each “table” is a YAML/JSON file under `data/journalist/...`. Loader/saver functions hide serialization and provide domain-specific helpers.

- **Messages:** `saveMessage`, `getMessages`, `findMostRecentUnansweredMessage`, `deleteMessageFromDB`, `updateDBMessage`, `loadMessageFromDB`, `deleteSpecificMessage`.
- **Cron Jobs:** `loadCronJobs`, `updateCronJob`.
- **Journal & Queue:** `saveJournalEntry`, `loadUnsentQueue`, `updateQueue`, `clearQueue`, `saveToQueue`, `deleteUnprocessedQueue` (not shown above), `loadJournalMessages`.
- **Quiz:** `loadQuizQuestions`, `loadQuestionByCategory`, `answerQuizQuestion` (legacy support).
- **Nutrilogs:** `saveNutrilog`, `getNutrilog`, `getNutrilogByMessageId`, `getSingleMidRevisionNutrilog`, `deleteNutrilog`, `getNutrilogSummary`, `getNonAcceptedNutrilogs`, `assumeOldNutrilogs`, `updateNutrilogStatus`, `getPendingUPCNutrilogs`, `getTotalUPCNutrilogs`.
- **Nutrilist:** `saveNutrilist`, `getNutrilListByDate`, `getNutrilListByID`, `deleteNuriListById`, `updateNutrilist`, `clearNutrilistByLogUUID`, `nutriLogAlreadyListed`, `loadNutrilogsNeedingListing`, `loadRecentNutriList`, `getMostRecentNutrilistItems`, `getNutrilistItemsSince`.
- **Cursor:** `setNutriCursor`, `getNutriCursor` hold conversational state (report message IDs, revision progress, etc.).
- **Insights:** `saveNutriDay`, `getNutriDay`, `getNutriDaysBack`, `saveNutriCoach`, `getNutriCoach`, `loadDailyNutrition` (stub), `saveActivities`, `loadActivities`, `saveWeight`, `loadWeight`.

Each function validates inputs, reads the corresponding YAML map, mutates entries, then persists via `saveFile`. Callers should treat returned structures as plain JS objects matching on-disk schema.

---

## 2. Data Stores
| Store | Example path | Shape | Producers | Consumers | Notes |
| --- | --- | --- | --- | --- | --- |
| Messages | `data/journalist/messages/b6898194425_u575596036.yaml` | Map `<chat_id>_<message_id>` → `{timestamp, sender_id, text, foreign_key}` | `saveMessage`, queue importers | Telegram history tools, `loadJournalMessages`, diagnostics |
| Nutrilogs | `data/journalist/nutribot/nutrilogs/b6898194425_u575596036.yaml` | Map `uuid` → `{chat_id, message_id, food_data, status, upc?, factor?}` | `saveNutrilog`, `updateNutrilogStatus`, `assumeOldNutrilogs` | `handlePendingNutrilogs`, `postItemizeFood`, review flows |
| Nutrilists | `data/journalist/nutribot/nutrilists/b6898194425_u575596036.yaml` | Map `uuid` → per-food row (icon, item, amount, macros, date, `log_uuid`) | `saveNutrilist`, UPC saver, adjustments | Report generation, calorie sums, revisions |
| NutriCursor | `data/journalist/nutribot/nutricursors/b6898194425_u575596036.yaml` | Map key → `{chat_id, timestamp, data}`; latest key is chat_id | `setNutriCursor` | `getNutriCursor`, `processRevisionButtonpress`, `removeCurrentReport` | Historical numeric keys appear when cursor was keyed by message_id; cleanup needed. |
| NutriDay | `data/journalist/nutribot/nutridays/b...yaml` | Map `date` → aggregated macros for the day | `saveNutriDay`, `compileDailyFoodReport` | `food_report`, analytics |
| NutriCoach | `data/journalist/nutribot/nutricoach/b...yaml` | Map `date` → `[ {timestamp, message, mostRecentItems} ]` | `generateCoachingMessage` | Potential push-history, analytics |
| Cursored UPC images | `nutribot/images/...` via CDN | Cached photos used in reports | `searchImage`, `canvasImage` | Telegram attachments |

All stores are YAML (via `io.mjs`). Keys are not ordered; lookups usually load entire file, so refactor plans should consider introducing indexed storage or Supabase-equivalent.

---

## 3. Data Flows
### A. Text or Voice Meal Log
1. Telegram sends text/voice → `processFoodLogHook`.
2. Optional slash commands handled; for text/voice, webhook deletes source message and posts “Analyzing…” placeholder.
3. `detectFoodFromTextDescription` returns structured `{uuid, food[], date, time}`.
4. `processFoodListData` formats response, saves nutrilog (`status: init`).
5. User taps inline action:
	- `✅ Accept` → `acceptFoodLog` → `saveNutrilog(status: accepted)`.
	- `❌ Discard` → message + DB entry removed.
	- `🔄 Revise` → cursor enters revision mode awaiting user input.
6. Upon acceptance, `handlePendingNutrilogs` eventually converts to nutrilist rows and `postItemizeFood` may regenerate report/coaching if queue empty.

### B. Photo Meal Log
1. Telegram supplies `file_id`; `processImgMsg` fetches via `/telegram/img`, deletes original.
2. `processImageUrl` posts real photo (or OG fallback), converts to base64, calls `detectFoodFromImage`.
3. Remainder mirrors text flow (inline actions, acceptance, listing, reporting).

### C. UPC Scan
1. Numeric text or explicit `upc` param triggers `processUPC`.
2. `upcLookup` attempts OpenFoodFacts → Edamam fallback; attaches GPT-derived color/icon if available.
3. Telegram shows product image + caption + inline portion grid; nutrilog stored with `upc` and `status: init`.
4. Portion choice handled by `processUPCServing`, which scales nutrients, saves nutrilist entries (`log_uuid` = nutrilog uuid) and marks nutrilog accepted.
5. `checkAndGenerateCoachingIfComplete` runs after each selection to auto-report when queues empty.

### D. Revision / Adjustment Loop
1. `reviseFoodLog` swaps inline buttons for instruction prompt; cursor stores `{revising: {message_id, uuid}}`.
2. New text/photo processed via `processRevision` → GPT (image/text) with prior data, updates nutrilog `status: revised`.
3. `processRevisionButtonpress` provides post-report adjustments (change portion, delete, move to another day) using cursor levels to navigate date/item/factor.

### E. Report Generation & Coaching
1. Triggered automatically once no pending items remain or manually via help → Report.
2. `postItemizeFood` ensures nutrilogs → nutrilist, then requests `generateCoachingMessage` for caption.
3. Report image is fetched via `nutribot_report_host/foodreport?...` which calls `food_report.mjs/generateImage` server-side.
4. Message saved in cursor to enable “⬅️ Adjust” sessions; deleting report resets cursor.

### F. Help / Coach Utilities
Help menu toggles review counts, manual report, and standalone coaching message. These reuse the same data sources but bypass automatic gating.

---

## 4. External Interfaces
- **Telegram Bot API:** `processFoodLogHook` expects Telegram webhook payload shape (message, callback_query, etc.). Uses helper module `lib/telegram.mjs` (not covered here) for `sendMessage`, `sendImageMessage`, `updateMessage`, `deleteMessage`, inline keyboards.
- **OpenAI GPT APIs:** `gpt_food.mjs` is the abstraction. Models currently set to `gpt-4o` for all calls (vision + text + coaching). Strict JSON responses enforced by prompts; responses logged under `data/gpt/` for auditing.
- **OpenFoodFacts / Edamam / UPCItemDB / FatSecret / Google CSE:** `upc.mjs` orchestrates upstream API calls. Requires environment variables (`ED_APP_ID`, `ED_APP_KEY`, `UPCITE`, `FS_APP_KEY`, `FS_APP_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`, `nutribot_report_host`).
- **Canvas Rendering:** `food_report.mjs` uses `node-canvas`; fonts configured via `process.env.path.font`. Assets (icons) expected at `process.env.path.icons`.
- **Filesystem Storage:** All state lives under `/Volumes/mounts/DockerDrive/Docker/DaylightStation/data/...` via `loadFile`/`saveFile`. Consumers must handle potential contention if future refactor introduces concurrent workers.

When decoupling layers, treat these as contract boundaries: Telegram adapter ↔ ingestion orchestrator, GPT services ↔ food parsing, data access ↔ persistent YAML, and rendering ↔ CDN endpoints.

---

## 5. Canonical Use Cases
1. **User logs meal by text.** GPT parses description, Telegram displays structured summary, user accepts, macros are populated, nightly report updates automatically.
2. **User logs meal by photo.** Same as above but uses GPT vision; fallback path handles non-image URLs (meta tags). Revision loop supports clarifications.
3. **User scans barcode.** UPC string leads to Edamam/OFF lookup, user selects multiplier, entry auto-classified with noom color/icon, nutrilist row gains precise macros.
4. **User revises prior entry.** Inline “🔄 Revise” transitions to free-form correction; GPT merges context, nutrilog marked `revised`. Adjustment menu allows scaling, moving date, or deleting items from aggregated report.
5. **User requests help/report/coach.** `/help` command shows inline options. `📋 Review` reveals pending counts with “Confirm All”. `📊 Report` forces report generation even with assumed entries. `💡 Coach` generates GPT tip independent of new data.
6. **System generates daily report image.** `postItemizeFood` fetches `nutribot_report_host/foodreport`, which ultimately calls `food_report.mjs/generateImage`. Result posted with coaching caption and stored in cursor for future adjustments.

These scenarios intertwine ingestion, GPT enrichment, and storage; documenting them clarifies seams for the upcoming decoupling (Telegram transport vs. food processing vs. persistence).

---

### Next steps for refactor readiness
- Formalize interfaces between modules described above (e.g., define TypeScript types or JSON schemas for nutrilog/nutrilist records).
- Consider replacing direct `loadFile`/`saveFile` calls with repository classes to keep transport-independent logic pure.
- Extract GPT and UPC integrations into dedicated service layer so ingestion can target mocks during tests.

