# Chatbots Refactor Design Specification

> Goal: Re-architect the existing `backend/journalist` (food logging, journaling, GPT coaching, reporting, Telegram integrations) into a modular, testable, observable, and extensible chatbot framework under `backend/chatbots/`.

---

## 1. Current State (Extracted Components & Responsibilities)

### Monolithic Entry & Routing
- `journalist.mjs` defines a flat Express router mapping endpoint names to functions with minimal separation of concerns.
- Responsibilities mixed: transport (Express), business logic (food logging, coaching), external I/O (Telegram, GPT, filesystem), and persistence assumptions.

### Key Functional Modules
| Area | Files (examples) | Responsibilities (observed) |
| ---- | ---------------- | ---------------------------- |
| Food Detection & GPT | `lib/gpt_food.mjs` | Image → food inference, text parsing, macro inference, rate limiting, coaching message generation. |
| Food Log Workflow | `foodlog_hook.mjs` | Telegram webhook ingestion, state/cursor logic, UPC lookup flow, serving selection, confirmation buttons, GPT revision cycles, report triggers. |
| Food Report Rendering | `food_report.mjs` | Scan daily nutrilogs, macro aggregation, icon/font loading, composite image canvas (pie, list, history bars, stats). |
| Telegram Journalist | `telegram_hook.mjs` | Generic Telegram webhook for journaling prompts, slash commands, quiz answer handling, voice transcription. |
| Journaling | `journal.mjs` + `lib/journalist.mjs` (implied) | Diary prompts, conversation memory, saving messages. |
| Persistence Helpers | `lib/db.mjs` (referenced) | Message storage, queue management, nutrilog retrieval/update. |
| Media / IO | `lib/io.mjs` | Saving payload snapshots, image handling. |
| External Services | Various in `backend/lib/` | Weather, calendar, fitness, GPT, etc. |
| Icons & Fonts | `journalist/icons/`, `journalist/fonts/` | Static assets for report generation. |

### Cross-Cutting Behaviors (Found Inline)
- Rate limiting (naive in-memory per-process map) for GPT calls.
- Retry loops for GPT endpoints (with exponential-style increment via `attempt` recursion, but not standardized).
- Timezone logic embedded in multiple files.
- Ad-hoc logging via `console.log` / `console.error` with inconsistent structure.
- Mixed error handling (sometimes early returns, sometimes status codes, sometimes silent).
- Business state sometimes encoded in Telegram message buttons, sometimes in DB, sometimes ephemeral (e.g., `cursor` concept in comments).

### Identified Pain Points
1. Tight coupling of transport layer to domain logic.
2. Repeated timezone, GPT, and Telegram interaction code → violates DRY.
3. Hard to test (pure logic mixed with side effects & I/O).
4. No clear domain models (FoodItem, NutriLogEntry, ChatSession, CoachingMessage) → implicit object shapes.
5. Observability gaps (no structured logs, metrics, or correlation IDs).
6. Error taxonomy absent (no classification for user errors vs transient infra vs logic bugs).
7. Image/report generation entangled with data fetching + side effects.
8. Implicit state flows (UPC queue, revision cycles) scattered → higher defect risk.
9. Scaling constraints (in-memory rate limit; no queue/backpressure for GPT or canvas rendering).
10. Environment variable reliance not validated centrally.

---

## 2. Functional Requirements (Explicit & Inferred)

### Core Use Cases
1. User logs food via Telegram (text, image, voice, UPC code) → System detects items, macros, and saves structured nutrilog entries.
2. User adjusts portions or revises GPT-parsed entries via interactive buttons / revision prompts.
3. System generates daily health / nutrition coaching messages.
4. System generates a composite daily nutrition report image with macros, list, charts, and icons.
5. Journal-style conversational logging (diary prompts, memory continuity).
6. Slash commands trigger context-specific actions (help, report, coach, review, confirm all, possibly others).
7. Voice messages are transcribed and treated as text input.
8. UPC barcode lookup resolves product nutrients with serving selection prompts.
9. GPT fallback/retry on partial or malformed responses (JSON extraction logic resilient to wrapping text / formatting noise).
10. De-duplication or merging of identical food items (aggregation in report).

### Non-Functional Requirements
- Modularity: Clean boundaries (domain vs infra vs interface).
- Testability: Pure functions for parsing/coaching logic; mocks for GPT/Telegram.
- Observability: Structured logs, metrics (counts, latency, errors), traces (optional later).
- Reliability: Idempotent webhook handling, resilient retries, circuit breaking for GPT.
- Performance: Avoid redundant GPT calls; cache icon paths, fonts, and normalized food items.
- Maintainability: Consistent naming, documentation, single responsibility modules.
- Extensibility: New bots (devotional, nutribot, homebot) reuse shared primitives.
- DRY: Central GPT client, Telegram client, time utilities, icon mapping loader, nutrition normalization.
- Security: Validate inputs, limit file system exposure, sanitize external data.
- Internationalization readiness: Timezone abstraction; potential localization of coaching text.

### Users / Personas
- Telegram End User (logs items, receives coaching/report).
- Bot Operator / Developer (needs diagnostics, config clarity, test harness).
- System (scheduled cron) triggers daily summaries/coaching.

---

## 3. Edge Cases & Failure Modes

| Area | Edge Case / Failure | Handling Strategy (Target) |
|------|---------------------|-----------------------------|
| Webhook Input | Missing `message` or `callback_query` | Return 200 early + structured log. |
| Env Vars | Missing API keys (Telegram, OpenAI) | Central bootstrap validator throws explicit StartupError. |
| GPT Response | Non-JSON, partial JSON, extraneous prose | Robust `extractJSON` utility with schema validation + retries + fallback classification. |
| Rate Limit | Too many GPT calls per minute | Shared token bucket per function + metrics + 429 style internal error surfaced gracefully to user (“Please wait”). |
| UPC Lookup | No result / partial nutrients | Send fallback message; skip coaching trigger; mark item incomplete. |
| Portion Selection | User ignores selection | Auto-expire after timeout; mark stale and exclude from completeness check. |
| Revision Flow | User revises after acceptance | Create new version linked to original; keep audit trail. |
| Voice Transcription | Empty or low-confidence | Ask user to repeat; do not create nutrilog entry. |
| Image Processing | Invalid URL / fetch timeout | Retry (x2) then fallback to manual text prompt. |
| Icon Mapping | Missing icon for food | Use `default.png`; log metrics increment. |
| Timezone | Unset or invalid | Fallback to `America/Los_Angeles`; warn once. |
| Concurrency | Duplicate webhook deliveries (Telegram retry) | Idempotency key: combine bot_id + message_id hashed; skip if processed. |
| Persistence | DB transient failure | Retry with exponential backoff; circuit open if sustained; queue to DLQ (if introduced later). |
| Report Generation | No food for day | Return friendly message instead of image. |
| Coaching Generation | GPT failure after max retries | Fallback generic encouragement message. |
| Memory Growth | In-memory maps unbounded (rate limit, help cache) | Add LRU or TTL eviction policy. |

---

## 4. Target Architecture Overview

Layered + Hexagonal (Ports & Adapters) Approach

```
backend/chatbots/
	├─ app/                # Application services (use cases)
	├─ domain/             # Pure domain models & logic (no I/O)
	├─ infra/              # Adapters: GPT, Telegram, DB, Files, Time, Logging
	├─ interfaces/         # HTTP / Webhook controllers & route wiring
	├─ bots/               # Bot-specific composition (nutribot, journalist, etc.)
	├─ shared/             # Cross-cutting utilities (config, errors, telemetry)
	├─ scripts/            # One-off maintenance / migrations
	└─ tests/              # Unit + integration tests
```

### Domain Layer (Pure)
- Entities: `FoodItem`, `NutriLogEntry`, `NutritionSummary`, `ChatMessage`, `CoachingAdvice`, `UPCProduct`, `Revision`, `ReportSpec`.
- Value Objects: `MacroBreakdown`, `Portion`, `TimeWindow`, `UserId`, `ChatId`.
- Services (pure logic): `FoodAggregator`, `MacroCalculator`, `ReportLayoutEngine` (structure only; rendering via adapter), `CoachingStrategy`.

### Application Layer (Use Cases)
Use case orchestrators coordinating domain + infra adapters:
- `LogFoodFromText` / `LogFoodFromImage` / `LogFoodFromUPC`.
- `ReviseNutriLogEntry`.
- `ConfirmPortionSelection`.
- `GenerateDailyReport`.
- `GenerateCoachingMessage`.
- `HandleSlashCommand`.
- `ProcessTelegramWebhook` (delegates to sub-handlers mapping input type → use case).

### Infrastructure Layer (Adapters)
- GPT Client (unified with pluggable model, concurrency guard, structured retries, JSON schema validation optional).
- Telegram Client (sendMessage, editMessage, deleteMessage, sendImage, setButtons, consistent error wrapping).
- Persistence (abstract repository interfaces: `NutriLogRepository`, `MessageRepository`, `CursorStateRepository`, `ConfigRepository`).
- Asset Loader (icons/fonts caching, lazy load, integrity checks).
- Image Renderer (Canvas abstraction; takes `ReportLayout` DTO, outputs Buffer / stream).
- Time Service (timezone, now, scheduling hooks).
- Rate Limiter (token bucket or sliding window; per action key; pluggable store for scaling later).
- Logger (pino / console wrapper) + metrics emitter (e.g., simple in-memory counters now; future: Prometheus).

### Interface Layer
- Express routers (or future serverless handlers) that map HTTP → application commands.
- Validation layer (zod / custom schemas) ensuring inbound payload shape before domain.
- Error mapping (DomainError → 4xx; InfraError → 5xx; RateLimit → 429 style code).

### Bot Composition Layer
- Each bot exports: `register(botRegistry)` or config object defining:
	- triggers (slash commands, prefixes)
	- capabilities (food logging, journaling, devotions)
	- AI profiles (prompt templates)
	- feature flags (e.g., enableCoaching: true)

---

## 5. Core Data Models (Illustrative Interfaces)
```ts
// domain/models.ts
type ChatId = string; // e.g., b<bot_id>_u<user_id>
interface FoodItem {
	id: string;          // uuid
	name: string;
	icon?: string;       // icon key
	noomColor?: string;  // traffic-light color
	calories: number;
	protein?: number; carbs?: number; fat?: number;
	quantity?: number; unit?: string; // original portion
	source: 'text' | 'image' | 'upc' | 'revision';
	confidence?: number; // from GPT or classifier
	createdAt: Date;
}

interface NutriLogEntry {
	uuid: string;
	chatId: ChatId;
	items: FoodItem[]; // may be >1 if grouped
	status: 'pending' | 'needs_portion' | 'confirmed' | 'discarded' | 'revised';
	originalText?: string;
	imageUrl?: string;
	upc?: string;
	revisions: Revision[];
	createdAt: Date;
	updatedAt: Date;
}

interface Revision {
	timestamp: Date;
	note: string; // user feedback
	delta: Partial<FoodItem>[]; // structural change
}

interface CoachingAdvice {
	chatId: ChatId;
	date: string; // YYYY-MM-DD
	message: string;
	score?: number;
	macroSummary?: MacroBreakdown;
}

interface MacroBreakdown { protein: number; carbs: number; fat: number; calories: number; }

interface UPCProduct {
	code: string;
	label: string;
	image?: string;
	servingSizes: { quantity: number; label: string; }[];
	nutrients: Record<string, number>; // raw map, normalized later
}

interface ReportSpec {
	date: string;
	chatId: ChatId;
	entries: NutriLogEntry[];
	summary: MacroBreakdown;
	groupedItems: FoodItem[]; // aggregated
}
```

---

## 6. Observability Plan
- Structured Logger fields: `{ ts, level, msg, chatId, botId, traceId, action, status, durationMs }`.
- Metrics (initial):
	- `gpt_calls_total{endpoint}`
	- `gpt_failures_total{reason}`
	- `food_items_logged_total{source}`
	- `nutrilog_status_total{status}`
	- `report_generation_ms` (histogram)
	- `telegram_api_errors_total{method}`
	- `rate_limit_hits_total{key}`
	- `icon_missing_total`
- Optional tracing stub: inject `traceId` per webhook request.
- Health endpoint: returns dependency checks (env vars, font/icon load count, recent GPT error rate).

---

## 7. Error Handling & Resilience
Error Classes:
- `ValidationError` (400)
- `RateLimitError` (429)
- `NotFoundError` (404)
- `DomainError` (422)
- `ExternalServiceError` (502)
- `InfrastructureError` (500)

Patterns:
- Central `errorMiddleware` maps to HTTP codes + structured log.
- GPT retries: up to N attempts with jittered backoff (e.g., 250ms * 2^attempt + random 0–100ms). On final failure produce fallback message or mark entry `pending_review`.
- Idempotency: Hash of `(botId, messageId)` persisted; duplicate webhook returns cached outcome.
- Circuit breaker (simple): Track rolling failure ratio; if threshold exceeded, short-circuit GPT calls for cooldown window.
- Rate limiting: In-memory token bucket now; interface allows Redis adapter later.

---

## 8. DRY Utilities & Shared Services
| Utility | Purpose |
| ------- | ------- |
| `time.ts` | Now(), formatDate(), parseUserLocal(), timezone resolution. |
| `config.ts` | Load & validate env (zod). Expose typed object. |
| `logger.ts` | Structured logging wrapper. |
| `metrics.ts` | Simple in-memory counters/gauges + export snapshot. |
| `gptClient.ts` | Unified OpenAI invocation; JSON schema enforcement; streaming optional. |
| `telegramClient.ts` | Typed wrapper; retry on 429/5xx; message templating. |
| `nutriNormalizer.ts` | Map raw nutrients to canonical (kcal, protein_g, carbs_g, fat_g). |
| `iconRegistry.ts` | Lazy scan icons directory once; fallback logic. |
| `imageRenderer.ts` | Composes canvases; pure function `buildReportLayout(spec)` + adapter `renderToPng(layout)`. |
| `rateLimiter.ts` | Generic token bucket. |
| `idempotency.ts` | Compute + persist idempotency keys. |
| `jsonExtract.ts` | Robust extraction & schema refine. |
| `schema.ts` | zod schemas for inputs (webhook payloads, GPT outputs). |

---

## 9. Proposed Directory Structure
```
backend/chatbots/
	bots/
		nutribot/
			config.ts
			prompts/
			index.ts          # registers nutribot capabilities
		journalist/
			config.ts
			prompts/
			index.ts
	domain/
		models.ts
		services/
			foodAggregator.ts
			macroCalculator.ts
			coachingStrategy.ts
			reportLayoutEngine.ts
	app/
		usecases/
			logFoodFromText.ts
			logFoodFromImage.ts
			logFoodFromUPC.ts
			reviseEntry.ts
			confirmPortion.ts
			generateReport.ts
			generateCoaching.ts
			processTelegramWebhook.ts
		mappers/
			telegramInputMapper.ts
	infra/
		gpt/
			gptClient.ts
		telegram/
			telegramClient.ts
		persistence/
			nutrilogRepository.ts
			messageRepository.ts
			idempotencyStore.ts
		assets/
			iconRegistry.ts
			fontLoader.ts
		rendering/
			imageRenderer.ts
		logging/
			logger.ts
			metrics.ts
		time/
			timeService.ts
		rateLimit/
			rateLimiter.ts
	interfaces/
		http/
			router.ts
			controllers/
				telegramController.ts
				reportController.ts
				healthController.ts
	shared/
		config.ts
		errors.ts
		result.ts          # functional Result<E, T> helper
		jsonExtract.ts
		schema/
			gptSchemas.ts
			webhookSchemas.ts
	tests/
		unit/
		integration/
		fixtures/
```

---

## 10. Migration & Rollout Strategy
1. Bootstrap Foundation
	 - Add shared config, error classes, logger, metrics, GPT client abstraction.
2. Extract Pure Domain
	 - Move macro calc + aggregation logic from `food_report` & `foodlog_hook` → `domain/services`.
3. Implement Repositories
	 - Wrap existing DB access (currently implicit in `lib/db.mjs`) behind interfaces.
4. Parallel Routing
	 - Introduce new `/api/chatbots/*` routes using new architecture while keeping legacy `/journalist/*` endpoints.
5. Feature Flags
	 - Route a small percentage (or specific chatIds) to new pipeline for food logging.
6. Incremental Porting
	 - UPC flow → new use case.
	 - Text & image detection → new GPT pipeline.
	 - Revision & portion selection → new state machine.
	 - Report generation → image renderer abstraction.
7. Validation & Metrics
	 - Compare output parity (macro totals, item counts) between old and new for sampled sessions.
8. Switch Default
	 - After confidence, point Telegram webhooks to new controller.
9. Deprecate Legacy
	 - Freeze changes in old code; schedule removal after stability window.
10. Cleanup
	 - Remove unused legacy files; update README + diagrams; enforce lint/test gates.

Rollback Considerations: Keep ability to route traffic back to legacy by env flag `CHATBOTS_ROLLOUT_STRATEGY=legacy|dual|new`.

---

## 11. Testing Strategy
- Unit: Pure services (aggregation, coaching heuristics, JSON extraction, layout engine).
- Contract: GPT schema mock responses; Telegram payload mapping.
- Integration: End-to-end webhook simulation (text → nutrilog → confirm → report).
- Snapshot: Report image pixel checksum (allow small tolerance) or structured layout snapshot before rendering.
- Load (optional later): Simulate burst of 50 webhook events to verify rate limiting + latency.

---

## 12. Security & Privacy
- Avoid logging raw voice/image URLs unless needed (flag for debug).
- Redact API keys in error outputs.
- Validate UPC/text length (prevent abuse).
- Consider per-user rate limits beyond GPT call limits.
- Escape dynamic text in buttons/messages to avoid formatting injection.

---

## 13. Performance Optimizations (Planned)
- Cache icon metadata + font load globally (cold start warmup function).
- Batch GPT classification for multi-item inputs where possible.
- Debounce coaching generation until all pending items resolved.
- Pre-compute daily macro summary on each confirmation (append-only log + running totals) to accelerate report generation.

---

## 14. Open Questions / Assumptions
- DB Technology? (Assumed existing repository pattern can wrap current implementation.)
- Need multi-bot isolation for rate limiting? (Assume per-bot key namespace.)
- Are there user-specific macro goals? (If yes, incorporate `UserProfileRepository`.)
- Do we support multilingual prompts? (Future: prompt templates keyed by locale.)
- Should coaching be cached per day to avoid regeneration after each log? (Assume yes with invalidation on new confirmed entry.)

---

## 15. Implementation Phases & Effort (Rough)
| Phase | Scope | Est. Effort |
| ----- | ----- | ----------- |
| 1 | Core shared utilities + config validation | 0.5–1 day |
| 2 | Domain models + services extraction | 1–2 days |
| 3 | GPT + Telegram adapters | 1 day |
| 4 | Use cases (text/image/UPC logging) | 2 days |
| 5 | Revision + portion state machine | 1–1.5 days |
| 6 | Report renderer refactor | 2 days |
| 7 | Coaching generation pipeline | 1 day |
| 8 | Observability (metrics/logging) | 0.5 day |
| 9 | Integration tests & parity harness | 1 day |
| 10 | Rollout + cleanup | 0.5–1 day |

---

## 16. DRY Refactor Targets (Legacy → New)
| Legacy Pattern | New Abstraction |
| -------------- | --------------- |
| Inline GPT call wrappers | `infra/gpt/gptClient.ts` |
| `extractJSON` scattered usage | `shared/jsonExtract.ts` w/ schema param |
| Timezone manual calls | `timeService.now(chatId)` (user profile aware) |
| Console logs | `logger.info({action, ...})` |
| Raw Telegram REST usage | `telegramClient.send({ type, body })` |
| File system asset scan per request | Cached `iconRegistry` |
| Report function mixing fetch + render | Use case builds `ReportSpec`, renderer renders |
| Ad-hoc retries | Central `retry(fn, policy)` util |

---

## 17. Example Flow (New Pipeline)
1. Telegram webhook hits `interfaces/http/controllers/telegramController`.
2. Controller validates payload → maps to `WebhookEvent` DTO.
3. `processTelegramWebhook` use case determines intent (UPC, image, voice, text, command).
4. Delegates to specific use case (e.g., `logFoodFromImage`).
5. Use case: fetches image (infra), calls `gptClient.classifyFoodImage`.
6. Validates response JSON → maps to domain `FoodItem[]`.
7. Persists new `NutriLogEntry` (status `pending` or `needs_portion` if UPC factor needed).
8. Sends user interactive buttons (Telegram client) for portion or confirmation.
9. On confirmation, triggers recompute macro summary; potential coaching generation if all entries settled.
10. Daily report request triggers `generateReport` use case: collects confirmed entries → domain summary → layout → rendering → send image.

---

## 18. Sample GPT Client API (Proposed)
```ts
interface GPTClient {
	classifyFoodImage(input: { url: string }): Promise<FoodItem[]>;
	parseFoodText(input: { text: string }): Promise<FoodItem[]>;
	coachingMessage(input: { summary: MacroBreakdown; recentItems: FoodItem[]; timeOfDay: string }): Promise<CoachingAdvice>;
	colorAndIcon(input: { name: string }): Promise<{ icon: string; noomColor: string; }>;
}
```

---

## 19. Acceptance Criteria for Refactor Completion
- All legacy journalist food logging endpoints served by new architecture without user-visible regression.
- Average GPT call latency unchanged or improved (cache/memo where feasible).
- 90%+ code in domain + app layers pure/testable (side effects confined to infra).
- Structured logs present for every webhook with traceId and action outcome.
- Report generation function unit tested + integration tested with fixture data.
- Documentation (this spec + quickstart) updated.
- Toggle to revert to legacy path functional during rollout.

---

## 20. Quickstart (Future README Section)
After implementation, provide commands like:
```
pnpm install
pnpm test
pnpm dev
```
And environment template describing required keys.

---

## 21. Next Immediate Steps
1. Implement shared `config.ts` validator.
2. Introduce `logger.ts` + replace console usage incrementally.
3. Extract domain models & macro calculator.
4. Wrap GPT + Telegram calls with adapters.
5. Port text → nutrilog flow as first vertical slice.

---

This document will evolve as implementation reveals additional nuances.

