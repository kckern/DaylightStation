# Nutribot Layered Architecture (Proposed)

## 0. Design Goals
- **Isolation:** Keep Telegram-isms (chat IDs, reply markup, webhooks) outside the Nutribot core; hide storage formats and GPT prompts behind interfaces.
- **Deterministic testing:** Expose every flow via dependency-free APIs that can be exercised by a test harness without Telegram or OpenAI.
- **Swap-friendly adapters:** Use dependency injection so data stores, AI providers, and transport layers can be replaced (e.g., move from YAML to Postgres, from OpenAI to local model) without touching Nutribot logic.
- **Typed identity mapping:** Translate Telegram bot/user IDs into Nutribot actors (botName/userName) via configuration before events touch the core; the reverse translation is handled only by the Telegram adapter.
- **Pure orchestration:** Nutribot core never executes IO directly; it produces `DomainResponse[]` that adapters fulfill, preserving determinism and keeping transports/providers at the edges.

```
┌─────────────────────┐      ┌──────────────────────┐      ┌──────────────────┐
│ Telegram Adapter(s) │ ---> │     Nutribot Core     │ ---> │ Data Access Layer │
└─────────────────────┘      └──────────────────────┘      └──────────────────┘
								   ▲
								   │
┌─────────────────────┐            │
│ Test Harness Layer  │ ----------┘
└─────────────────────┘
								   │
								   ▼
						┌──────────────────────┐      ┌──────────────────┐
						│    AI Service Layer   │ ---> │ External providers│
						└──────────────────────┘      └──────────────────┘
```

				The Express entrypoint in `backend/chatbots/nutribot/nutribotRouter.mjs` wires these layers together by exposing `/webhook`, `/report`, `/report/img`, and `/coach` endpoints, delegating Telegram payloads to the adapter and triggering manual functions/events for operations.

## 1. Layers & Responsibilities

### 1.1 Telegram Adapter Layer
- **Scope:** Express/fastify handlers, Telegram API clients, keyboard builders, cursor persistence tied to message IDs.
- **Interfaces exposed:**
	- `TelegramEvent` → normalized structure containing `actor`, `bot`, `eventType`, `payload`, `metadata` (raw message IDs, reply data).
	- `TelegramCommandBus` for outbound responses, translating Nutribot `DomainResponse` objects into Telegram-specific API calls (messages, edits, deletions, inline keyboards).
- **Key tasks:**
	- Map `(telegram_bot_id, telegram_user_id)` to `(botName, userName)` using configuration (e.g., YAML or DB table) before handing events to Nutribot.
	- Maintain adapter-level cursor objects if Telegram requires state (e.g., message IDs for deletion). Nutribot receives opaque `cursorTokens` when necessary.
	- Retry/back-off logic for Telegram errors without involving Nutribot.
- **Implementation note:** `backend/chatbots/nutribot/nutribotTelegram.mjs` hosts the adapter, consuming the router’s webhook events and translating to `NormalizedEvent` objects before calling the core. It also emits transport-specific actions when it receives `DomainResponse` objects.

### 1.2 Nutribot Core Layer
- **Scope:** Stateless (from transport POV) orchestration of nutrition workflows: ingestion, review, revisions, reporting, coaching triggers.
- **Main entrypoint:** `NutribotService.handle(Event, Context)` where:
	- `Event` is transport-agnostic (domain enums such as `MealTextLogged`, `MealImageLogged`, `BarcodeCaptured`, `UserChoiceCommitted`, `IntentInvoked`, `SystemTrigger`).
	- `Context` includes `user`, `bot`, `tenant`, `cursorTokens`, feature flags, and dependency handles (`ai`, `store`, `clock`).
- **Dependencies injected:**
	- `NutrilogRepo`, `NutrilistRepo`, `CursorRepo`, `ReportRepo`, `CoachRepo` (read/write nutrilogs, nutrilists, cursors, reports, coach messages).
	- `AIServices` interface (detailed below) plus `NutritionProvider` and `ReportRenderer` ports.
- **Outputs:** `DomainResponse[]` — declarative actions such as `displayMealSummary`, `requestPortionChoice`, `publishReport`, `promptUserInput`, `acknowledgeCommand`, each carrying semantic payloads (text, structured list, buttons keyed by semantic IDs, etc.).
- **Execution model:** Core is referentially transparent: every invocation consumes `(Event, Context)` plus repository/AI handles and returns `{ responses, jobs }`. `responses` are declarative `DomainResponse` objects; `jobs` is an array of `JobDescriptor` items describing follow-up work (e.g., `ItemizeLog`, `SummarizeDay`) that the adapter/worker enqueues deterministically.
- **Implementation note:** `backend/chatbots/nutribot/nutribotCore.mjs` exports `NutribotService` plus helper factories that wire the injected repos/AI/rendering providers.

#### 1.2.1 Deterministic execution, idempotency, and coordination
- Every `Event` carries a ULID `eventId`, canonical `sourceRef` (Telegram `message_id`, callback token, or CLI UUID), and `occurredAt` (ISO UTC). Source refs follow `transport:messageId` format so different transports never clash.
- Idempotency authority lives in `NutrilogRepo.findBySourceRef` + a unique constraint on `(tenant, user, sourceRef)`. Telegram adapter keeps a best-effort Redis cache for faster rejects, but the data layer is the single source of truth so duplicates are suppressed even if adapters reset.
- Coordination is achieved through repository CAS + job scheduling. A lightweight `CoordinationPort` (optional) can advise whether the system is already working on `(tenant:user)` but must return immediately; no blocking waits inside the core. If the port reports "busy", Nutribot emits `Acknowledge("Still processing", info)` and schedules a retry job instead of waiting.
- Repositories expose atomic helpers such as `transitionStatus(uuid, fromState, toState)` so itemization/reporting cannot race. Unique indexes on `(logUuid, actionId)` enforce idempotent adjustments.

#### 1.2.2 Nutrilog state machine & invariants
| State | Description | Allowed transitions |
| --- | --- | --- |
| `draft` | Parsed log awaiting confirmation | `accepted`, `discarded`, `revising` |
| `accepted` | User confirmed content; pending itemization | `itemizing`, `revising` |
| `itemizing` | AI currently enriching entries | `itemized`, `revising` |
| `itemized` | Entries written to nutrilist | `revising`, `closed` |
| `itemize_failed` | AI/itemizer error, awaiting retry/backoff | `itemizing`, `closed` |
| `render_failed` | Report rendering error, awaiting retry | `itemized`, `closed` |
| `revising` | User editing items or text | `revised`, `discarded` |
| `revised` | Revised draft ready for itemization | `itemizing`, `discarded` |
| `discarded` | Flow terminated | _terminal_ |
| `closed` | Historical lock once reports rendered; replaces `archived` | _terminal_ |

Each failed state stores `{ attempts, nextRetryAt, lastError }`. Repos enforce transitions and emit typed errors when calls violate invariants; the core converts those errors into user-facing prompts and enqueues retry `JobDescriptor`s respecting `nextRetryAt`.

#### 1.2.3 Cursor ownership
- **Transport cursor (adapter-owned):** Telegram maintains message IDs, inline keyboard metadata, etc. Adapters encode these as opaque `cursorTokens` and pass them through `DomainResponse.cardRef`. Nutribot stores the token only when it must ask for follow-up actions.
- **Domain cursor (transport-agnostic):** Stored through `CursorRepo` keyed by `(tenant, user, scenario)` for multi-step wizards (e.g., revision pointer, pending UPC quantity). Tests and other transports can read the same cursors without Telegram-specific knowledge.
- `CursorRepo` supports `setIfUnchanged(key, expectedVersion, newValue)` so concurrent flows cannot clobber progress. Cursor payloads store `{ version, updatedAt }`.
- **No knowledge of:** Telegram message IDs, inline keyboard syntax, OpenAI models, YAML paths.

#### 1.2.4 Card/token lifecycle guarantees
- `cardRef` and `cursorTokens` include `issuedAt` and optional `ttlSeconds`. Adapters persist them in a small KV store so crashes/restarts can restore outstanding cards.
- Recommended defaults: meal cards live 24h, report cards 7d, prompts 30m. Adapters garbage-collect expired refs and notify Nutribot via `SystemTrigger(Job=CleanupCards)` so cursors can clear.
- When adapters restart, they replay stored refs (per tenant:user) to rehydrate keyboards; Nutribot can safely ignore missing refs because every `DomainResponse` is idempotent and versioned.

### 1.3 AI Service Layer
- **Scope:** Encapsulate all prompt engineering, provider selection, retry logic, logging for GPT tasks.
- **Interfaces:**
	- `FoodVisionAI.analyzeImage(imageRef, options) -> FoodLogDraft`
	- `FoodTextAI.analyzeText(text, options) -> FoodLogDraft`
	- `FoodItemizerAI.enrichItems(items, extras) -> EnrichedItem[]`
	- `CoachingAI.generateMessage(context) -> CoachingTip`
	- `ClassifierAI.classifyLabel(label) -> {icon, noomColor}` (used by UPC path)
	- Optionally `InsightsAI.generateDailyHealthSummary(feed) -> Summary`
- **Implementation details hidden:** Which model, prompts, retries, audit logging path. Allows future swap to local LLM or different vendor.
- **Implementation note:** `backend/chatbots/nutribot/nutribotAI.mjs` instantiates these interfaces (wrapping OpenAI or other vendors) and exposes deterministic fakes for `_test`.
- **Error model:** Every method returns `Result<Payload, AIError>` where `AIError` is one of `Transient` (retryable), `Permanent` (bad input/over limit), or `ActionRequired` (needs user clarification). Nutribot decides follow-up prompts based on the error family.
- **Determinism hooks:** Optional `seed`/`fixtureId` lets the test harness or replay tools inject canned responses. AI layer guarantees bounding (image bytes resized, token ceilings, cost budgets enforced per request/user).

#### 1.3.1 Report rendering boundary
- `ReportRenderer.render(model)` returns `AssetRef { kind: 'buffer' | 'file' | 'url', mime, bytes?, path?, url?, sizeBytes }`.
- Default size cap = 512 KB. If rendering exceeds the cap or renderer fails (`RenderError`), Nutribot falls back to `PublishReport` with textual summary only and emits `Acknowledge("Report renderer unavailable", warn)`.
- Adapters decide how to upload assets: Telegram requires multipart upload (`kind=buffer|file`), while email might prefer `url`. Renderer never touches transport APIs.

### 1.4 Data Access Layer
- **Scope:** Provide repositories with clear contracts; hide YAML vs DB details.
- **Repositories:**
	- `NutrilogRepo` (CRUD nutrilogs, status transitions, lookups by UUID/message, pending queries)
	- `NutrilistRepo` (CRUD per-food entries, aggregates by date)
	- `CursorRepo` (store lightweight key/value states for transports/tests)
	- `ReportRepo` / `CoachRepo` / `MessageRepo` as needed
- **Implementation approach:** Start with adapter wrapping existing `db.mjs` functions; eventually swap for new persistence without touching Nutribot.
- **Persistence guarantees:** Repos expose compare-and-set helpers (e.g., `transitionStatus`, `reserveReportSlot`) so the core can reason in terms of transactions even when YAML is underneath. YAML adapters simulate atomicity via file locks + checksum validation; Postgres adapters will use transactions and unique constraints. Every stored entity carries `{ schemaVersion, updatedAt, updatedBy }` so migrations can evolve the shape safely.
- **Repo error taxonomy:** All repo methods return `Result<T, RepoError>` where `RepoError.family ∈ { NotFound, Conflict, TransientIO, Validation }`. Nutribot maps `Conflict` to friendly `Acknowledge` messages (e.g., "already processed") so users are guided instead of seeing raw stack traces. `TransientIO` triggers retries/backoff; `Validation` indicates programmer/config issues.
- **Implementation note:** `backend/chatbots/nutribot/nutribotData.mjs` contains the initial YAML-backed repository adapters and future Postgres implementations behind the same interfaces.

### 1.5 Test Harness Layer
- **Scope:** Simulate entire flows without Telegram or OpenAI.
- **Components:**
	- `ScenarioRunner` that feeds scripted `Event` objects into `NutribotService` with mock repositories and AI fakes.
	- Golden fixtures verifying outputs (responses, repo mutations) for text, image, UPC, revision, report flows.
	- CLI/HTTP endpoints to run regression suites locally or in CI.
- **Benefits:** Enables contract tests for Telegram adapter (verifying mapping between `DomainResponse` and Telegram API payloads) and for AI prompts (via deterministic fakes).

### 1.6 Nutrition Provider Port
- **Scope:** Dedicated port for barcode/UPC lookups and nutrition databases (Spoonacular, USDA, Open Food Facts). Keeps external fetches and caching out of the data access layer.
- **Interface:** `NutritionProvider.lookup(upc, opts) -> Result<UPCProduct, ProviderError>` where `ProviderError.family ∈ { NotFound, Transient, Permanent }`.
- **Caching strategy:** Layered decorator: in-memory LRU (≈15m) + persistent cache (Redis/Postgres table) with TTL 7–30d. Cache keys include `tenant` for per-tenant personalization.
- **Provider fan-out:** Config may list multiple providers with priority/fallback order. Adapter handles retries/backoff and normalizes output (serving size, nutrients, label, imagery) before returning to Nutribot.
- **Implementation note:** `backend/chatbots/nutribot/nutribotUPC.mjs` implements the `NutritionProvider` decorator stack (cache + vendor clients) so the core never touches HTTP APIs directly.

## 2. Interfaces & Contracts

#### 1.2.1 Event Taxonomy (transport-agnostic)

| Domain Event | Origin examples | Purpose |
| --- | --- | --- |
| `MealTextLogged` | Telegram text message, SMS, CLI input | User described a meal/snack in text form. |
| `MealImageLogged` | Telegram photo, email attachment | User shared an image representing food intake. |
| `BarcodeCaptured` | Numeric message, hardware scanner webhook | UPC/EAN captured for lookup. |
| `UserChoiceCommitted` | Telegram button tap, CLI menu selection | User selected one of Nutribot’s follow-up actions (accept, revise, adjust). |
| `IntentInvoked` | Slash command, voice shortcut, scheduled reminder reply | User invoked a high-level intent like “help”, “report”, “coach”. |
| `SystemTrigger` | External scheduler, cron, health sync | Infrastructure requested domain work such as `summarizeDay`, `verifyDailyInput`, or `sendReminder`.

`SystemTrigger` carries an explicit `job` identifier (e.g., `SummarizeDay`, `SendHealthDigest`). Transport layers schedule these jobs; Nutribot only exposes the callable entrypoints.

### 2. Interfaces & Contracts

#### 2.1 Telegram Adapter ↔ Nutribot Core
| Component | Direction | Payload | Notes |
| --- | --- | --- | --- |
| `NormalizedEvent` | Adapter → Core | `{ eventType, actor, bot, locale, payload, cursorTokens? }` | `eventType` values come from the domain taxonomy above; `payload` carries semantics (e.g., `text`, `imageUrl`, `choiceId`, `upcCode`, `jobId`). |
| `DomainResponse` | Core → Adapter | union: `SendMessage`, `SendImage`, `UpdateMessage`, `DeleteMessage`, `PromptInput`, `RenderReport`, `SetCursor`, `ClearCursor` | Adapter translates into Telegram calls; retains mapping between `response.messageRef` and Telegram `message_id`. |
| `CursorToken` | Bi-directional | Opaque string referencing adapter-managed cursor; Nutribot only stores/returns tokens. | Example: adapter encodes Telegram message ID + keyboard state, passes token back when Nutribot wants to adjust same card. |

**DomainResponse vocabulary & versioning**
- Every response carries `{ version, schemaHash, responseId }`. `version` increments on any payload change; `schemaHash` (short sha) helps adapters validate; `responseId` (ULID) lets adapters dedupe/retry delivery. `cardKindVersion` tags visual models (e.g., `mealSummary.v1`).
- `SendCard(cardKind, cardKindVersion, model, cardRef?, ttl?)`: post a structured card with semantic buttons. `ttl` hints when adapters can garbage-collect `cardRef`. `cardRef` embeds `{ cardKind, cardKindVersion }` so adapters can rehydrate after crashes.
- `UpdateCard(cardRef, cardKindVersion, model)`: mutate an existing card; adapters verify version compatibility before editing.
- `DeleteCard(cardRef)`: remove obsolete cards; adapters may ignore if already gone.
- `AskInput(kind, prompt, cardRef, cursorKey?)`: request free-text follow-up. Optional `cursorKey` tells CursorRepo which domain cursor to advance.
- `AskChoice(kind, options, cardRef)`: request semantic button input. Each `ActionOption` includes `actionId = cardKind.cardKindVersion.actionName` to prevent collisions across cards.
- `PublishReport(reportModel, layoutVersion, assetRef?, sizeLimitKb=512)`: signal that reporting is ready. If rendering fails or size exceeds limit, fall back to textual summary + `Acknowledge` warning.
- `SetCursor(key, value, version?)` / `ClearCursor(key, version?)`: maintain domain cursors with optimistic concurrency.
- `Acknowledge(message, severity, code?)`: send plain text confirmations/errors with optional machine-readable `code` (e.g., `duplicate-event`).

**UserChoiceCommitted payload contract**
- `action`: enum string such as `acceptLog`, `discardLog`, `startRevision`, `applyPortion`, `adjustItem`, `requestReport`, `requestCoach`.
- `args`: action-specific data (e.g., `{ logUuid }`, `{ logUuid, portionFactor }`, `{ itemId, op: "scale", factor }`).
- `cardRef`: optional token pointing to the originating card for optimistic updates.
- `actionId`: stable identifier used as an idempotency key inside Nutribot/Data layer. Format: `${cardKind}.${cardKindVersion}.${action}` (e.g., `mealSummary.v1.acceptLog`).

**JobDescriptor contract**
- `JobDescriptor = { job: 'ItemizeLog' | 'SummarizeDay' | 'ReconcilePending' | 'CleanupCards' | 'RenderReport'; args: Record<string, unknown>; idempotencyKey: string; notBefore?: string }`.
- Adapters enqueue jobs onto configured queues using `idempotencyKey` to prevent duplicates. `notBefore` enables debounce windows (e.g., report summarization).
- Jobs re-enter the core via `SystemTrigger` events so orchestration remains deterministic and testable.

**Adapter outbox & retries**
- Transport adapters persist outbound `DomainResponse` items in an outbox keyed by `responseId` until the downstream API confirms success. Retries reuse the same `responseId` to guarantee idempotency. After N failures, entries move to a dead-letter queue and Nutribot emits `Acknowledge("delivery-delayed", warn)` so users know action is pending.

### 2.2 Nutribot Core ↔ AI Layer
| Method | Input | Output | Usage |
| --- | --- | --- | --- |
| `ai.foodVision.analyze(imageRef, context)` | `imageRef`, optional revision context | `FoodLogDraft` (uuid, food[], date/time) | Image ingestion & revisions |
| `ai.foodText.analyze(text, context)` | Raw or revised description | `FoodLogDraft` | Text ingestion |
| `ai.itemizer.enrich(food[], extras)` | Basic items | Items with macros, icons, log_uuid | Listing & reports |
| `ai.classifier.classify(label)` | UPC label | `{noomColor, icon}` | Barcode flow |
| `ai.coach.generate(coachingContext)` | Calorie totals, thresholds, streaks | `CoachingTip` | Report caption, standalone coach command |

All methods return typed errors instead of throwing raw provider errors; Nutribot decides fallback behavior (e.g., ask user to retry, log warning).

### 2.3 Nutribot Core ↔ Data Access
| Repository | Key Methods | Purpose |
| --- | --- | --- |
| `NutrilogRepo` | `createDraft`, `updateStatus`, `findByMessageRef`, `listPending`, `assumeOlderThan`, `delete` | Manage ingestion lifecycle |
| `NutrilistRepo` | `replaceForLog(uuid, items)`, `listByRange(dateRange)`, `aggregate(dateRange)`, `moveItem`, `deleteItem` | Materialize per-food entries |
| `CursorRepo` | `get(key)`, `set(key, value)`, `delete(key)` | Transport-agnostic state (report references, revision progress) |
| `CoachRepo` | `saveMessage`, `latestForDate` | Persist AI outputs for analytics |
| `ReportRepo` | `saveSnapshot`, `latestForDate` | Support re-rendering without recomputation |

Repositories operate on domain models (plain JS objects) and never expose YAML paths. All date-sensitive operations accept `DateRange { start: string; end: string }` derived via helper `dayRangeFor(userPrefs, date)` so timezone math stays in the core. Adapters translate existing `db.mjs` functions into these contracts until storage is migrated.

#### 2.4 Reference TypeScript contracts
```ts
type DomainEvent = {
	id: string;
	type: 'MealTextLogged' | 'MealImageLogged' | 'BarcodeCaptured' | 'UserChoiceCommitted' | 'IntentInvoked' | 'SystemTrigger';
	actor: string;
	bot: string;
	tenant: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	cursorTokens?: string[];
};

type DomainResponse =
	| { kind: 'SendCard'; cardKind: string; model: unknown; cardRef?: string }
	| { kind: 'UpdateCard'; cardRef: string; model: unknown }
	| { kind: 'DeleteCard'; cardRef: string }
	| { kind: 'AskChoice'; cardRef: string; options: ActionOption[] }
	| { kind: 'AskInput'; cardRef: string; prompt: string; inputKind: 'text' | 'number' }
	| { kind: 'PublishReport'; reportModel: ReportModel; assetRef?: AssetRef }
	| { kind: 'SetCursor'; key: string; value: unknown }
	| { kind: 'ClearCursor'; key: string }
	| { kind: 'Acknowledge'; message: string; severity?: 'info' | 'warn' | 'error' };

interface NutrilogRepo {
	createDraft(draft: NutrilogDraft): Promise<Result<Nutrilog, RepoError>>;
	transitionStatus(uuid: string, from: Status, to: Status): Promise<Result<void, RepoError>>;
	findBySourceRef(ref: string): Promise<Nutrilog | null>;
	listPending(user: string, day: DayKey): Promise<Nutrilog[]>;
}

interface NutrilistRepo {
	replaceForLog(uuid: string, items: NutriItem[]): Promise<void>;
	aggregate(user: string, range: DateRange): Promise<NutriAggregate>;
	mutateItem(action: AdjustAction): Promise<Result<void, RepoError>>;
}

interface AIServices {
	foodText: FoodTextAI;
	foodVision: FoodVisionAI;
	itemizer: ItemizerAI;
	classifier: ClassifierAI;
	coach: CoachAI;
}

interface ReportRenderer {
	render(model: ReportModel): Promise<Result<AssetRef, RenderError>>;
}
```

## 3. Flow Reimagining

### 3.1 Text Ingestion Flow
1. Telegram adapter receives message, maps IDs, emits `Event{type:MealTextLogged}` with `payload.text`.
2. Nutribot uses `ai.foodText` to parse and `NutrilogRepo.createDraft` to persist `status: draft`.
3. Nutribot returns `DomainResponse.sendMealSummary` with semantic buttons (`accept`, `revise`, `discard`).
4. Adapter renders Telegram message + inline keyboard.
5. Button presses come back as `Event{type:UserChoiceCommitted, payload.action=accept, ref=mealCardToken}`; Nutribot updates status, triggers `handlePending`, etc.

### 3.2 UPC Flow
1. Adapter normalizes numeric message to `Event{type:BarcodeCaptured, payload.upc}`.
2. Nutribot queries `NutritionRepo.pendingUPC` for duplicates, then requests `DataAccess.lookupBarcode` (wrapper over `upcLookup`) returning standardized product data.
3. Nutribot produces `DomainResponse.requestPortionChoice`, referencing product metadata; adapter renders keyboard.
4. Acceptance leads to `NutrilistRepo.replaceForLog` and potential call to `ai.itemizer` for mixed entries.

### 3.3 Reporting Flow
1. Triggered by `Event{type:SystemTrigger, job=SummarizeDay}` or when queues empty.
2. Nutribot fetches todays items, composes `ReportModel` (text summary + chart data) and calls `ReportRenderer.render(reportModel)` (interface injected into core) to get an `AssetRef` (`buffer`, `filePath`, or pre-signed URL).
3. Response includes `publishReport` with `assetRef`, `coachingTip`, and `cursorToken` so adapter can support “Adjust” flows; if the adapter must upload the asset to Telegram, it uses the supplied `AssetRef` metadata.
4. Adjustments go through `Event{type:UserChoiceCommitted, payload={logItemId, action}}` irrespective of transport specifics.

## 4. Identity & Configuration
- **Mapping file/table:** `config/nutribot/actors.yml` (or DB) storing entries like:
	```yaml
	tenants:
		daylight:
			bots:
				telegram: { 6898194425: "nutribot" }
			users:
				telegram:
					575596036: "kirk"
	```
- Adapter reads mapping at startup and caches; falls back to registration API when encountering unknown IDs.
- Nutribot uses `Context.user = "kirk"`, `Context.bot = "nutribot"` everywhere else.
- `Context` also includes `clock` (injectable), `userPrefs` (`timezone`, `locale`, `unitSystem`, `dayStart`), and `tenant` metadata. “Day” calculations always use `userPrefs.dayStart`; when preferences change, a migration job backfills report windows.
- **Timekeeping:** All timestamps persisted as UTC ISO strings. `DayKey` = `[inclusiveStart, exclusiveEnd)` computed via `userPrefs.timezone` + `dayStart` (IANA TZ). DST gaps/overlaps rely on the timezone library; duplicate hours use the library’s order, gaps skip gracefully. When a user changes timezone/dayStart, mark the past 14–30 days “stale” and queue backfill jobs to recompute aggregates/reports; raw entries remain untouched.
- Unknown identities follow policy: deny by default, log metric, and optionally emit `Acknowledge` instructing the user to register through an admin channel. Self-serve linking can be layered on later by extending the adapter.
- **Security:** `/link` tokens use HMAC-SHA256 signed with per-tenant rotating secrets, 30–60 min TTL, and single-use enforcement via a consumed-token store. All logs/metrics hash user identifiers. Introduce `DeletionService` port so “forget me” requests wipe nutrilogs, nutrilists, AI artifacts, caches, and idempotency tables.

### 4.1 `nutribot.config.yaml`
- **Single source of truth:** All transports, AI providers, repos, queues, and feature switches are declared in `nutribot.config.yaml`. The loader reads `defaults`, merges `environments.<env>`, then overlays `tenants.<tenant>`; env vars can be referenced via `${env:VAR_NAME}`.
- **Strict schema:** Validated at boot (zod/io-ts). Unknown keys fail fast to keep deployments honest.
- **Hot reload optional:** In dev, file watchers can trigger config refresh; prod loads once at startup with checksum logged for audits.

Example (trimmed for clarity):
```yaml
version: 1
defaults:
	telemetry:
		logLevel: info
		otlpEndpoint: ${env:OTLP_URL}
	ai:
		provider: openai
		credentials:
			apiKey: ${env:OPENAI_API_KEY}
		models:
			foodText: { model: gpt-4o-mini, maxTokens: 1500, timeoutMs: 15000 }
			foodVision: { model: gpt-4o-mini-vision, timeoutMs: 20000 }
	queues:
		driver: redis
		redisUrl: ${env:REDIS_URL}
		namespaces: { ingestion: nutribot:ingest, itemization: nutribot:itemize, reporting: nutribot:report }
		debounce: { summarizeDayMs: 60000 }

tenants:
	daylight:
		identity:
			bots:
				telegram:
					- botId: 6898194425
						botName: nutribot
						webhookSecret: ${env:DAYLIGHT_WEBHOOK_SECRET}
			users:
				- userName: kirk
					transports:
						telegram: 575596036
		userDefaults:
			timezone: America/Los_Angeles
			dayStart: "04:00"
			unitSystem: us
		adapters:
			telegram:
				rateLimit: { burst: 20, perSecond: 1 }
				linkPolicy: { autoRegister: false, tokenTTLMinutes: 30 }
		ai:
			models:
				coaching: { model: gpt-4o, maxTokens: 800 }
		nutritionProvider:
			type: spoonacular
			baseUrl: https://api.spoonacular.com
			apiKey: ${env:SPOON_KEY}
			cache:
				memoryTtlSeconds: 900
				persistent: { driver: redis, ttlSeconds: 604800 }
		dataAccess:
			repoType: yaml
			yamlRoot: ./data/nutribot/daylight
			lockStrategy: flock
		features:
			enablePhotoFlow: true
			enableLinkCommand: true
```

### 4.2 Layer consumption of config
- **Bootstrapper:** `configLoader.load(env)` reads the YAML, interpolates env vars, validates schema, and hands each layer a typed slice (e.g., `Config.TelegramAdapter`). Dependency injection wires these slices into constructors.
- **Telegram adapter:** Uses `identity`, `adapters.telegram.rateLimit`, and `linkPolicy` to map IDs, enforce flooding thresholds, and decide whether `/link` is allowed. Webhook secrets + bot tokens live only in this layer.
- **Test harness:** Loads the same file but can override sections via `--config-overrides` CLI (e.g., swap repoType to `memory`).
- **Nutribot core:** Reads `userDefaults`, per-tenant feature flags, and thresholds (portion rounding, coaching gates). Core never sees transport secrets; it just receives `Context` already shaped by config.
- **AI service layer:** Binds to `config.ai` (provider, credentials, model names, timeout/cost caps). Enforces per-tenant budgets defined under `ai.limits` (e.g., `maxTokensPerDay`).
- **Nutrition provider port:** Instantiated from `config.nutritionProvider`, selecting vendor adapters and cache TTLs.
- **Data access layer:** Chooses repo implementation (`yaml`, `postgres`, `dynamodb`, etc.) based on `dataAccess.repoType`. Connection strings, table names, lock strategies, and schema versions live here. Migration tooling reads the same config to know where to apply changes.
- **Queue/backpressure layer:** `config.queues` feeds the background worker runtime (Redis namespace, debounce timers, retry/backoff policies). Both adapter and worker share the same names so `SystemTrigger` jobs route deterministically.
- **Observability:** `config.telemetry` injects log level, OTLP endpoints, sampling rates into every layer so traces/logs share IDs from the config bootstrap.

### 4.3 Overrides & secrets strategy
- **Secrets stay in env vars** referenced via `${env:VAR}` to avoid committing credentials. Local `.env` files can populate them in dev.
- **Per-environment overlays** (e.g., `environments.production.telemetry.logLevel: warn`) keep the main file mostly tenant-focused.
- **Runtime inspection:** An admin command `/config digest` can surface the loaded config hash + critical toggles without leaking secrets.

## 5. Testing Strategy
- **Unit tests:** Mock AI + repos, verify each event results in expected `DomainResponse` objects and repo mutations.
- **Flow tests:** Provide scripted sequences (text → accept → report) using in-memory repos. Assert final state (nutrilists, reports) and exported responses.
- **Adapter contract tests:** Replay recorded `DomainResponse` objects and assert generated Telegram API calls. Keep separate fixtures for new keyboards vs edits vs deletions.
- **AI sandbox tests:** Replace `AIServices` with deterministic stubs returning JSON fixtures to run CI without hitting OpenAI.

## 6. Migration Path
1. **Adapter shim:** Create `NutribotService` with adapters that wrap existing functions. Keep Telegram handler but translate to/from new events/responses incrementally.
2. **Repository wrappers:** Implement interfaces by calling current `db.mjs`. Once stable, backend storage can be swapped without affecting Nutribot.
3. **AI extraction:** Move GPT prompt logic from `gpt_food.mjs` into AI service implementations; Nutribot core now calls interfaces only.
4. **Testing harness:** Build CLI that reads sample payloads and runs them through `NutribotService` with mock adapters, expanding coverage before any transport changes.

### 6.1 Thin-slice execution plan (refined DoD)
- **Week 1 (DoD):**
	1. Ship TypeScript contract files (`events.ts`, `responses.ts`, `repos.ts`, `ai.ts`, `nutrition-provider.ts`, `renderer.ts`, `results.ts`).
	2. Implement in-memory repos with CAS + idempotency table, fake AI/NutritionProvider/ReportRenderer adapters, and the `WorkCoordinator` (per-tenant:user).
	3. Implement `NutribotService.handle` for `MealTextLogged` and `UserChoiceCommitted (acceptLog)` including deterministic golden tests:
		- text → accept → itemize → publish mini report
		- duplicate webhook suppressed via sourceRef
		- double accept returns info `Acknowledge` without side effects.
- **Week 2:** Wire UPC flow, integrate YAML-backed repo adapters, exercise NutritionProvider caching, and connect the Telegram adapter slice plus observability metrics.
- **Week 3:** Add photo/revision flows, adjustment UX, coaching prompts, identity linking CLI, and async worker plumbing with debounce/rate limits.

## 7. Observability & Backpressure
- **Instrumentation:** `Context.logger`, `metrics`, and `tracer` are injected just like repos/AI. Every `Event` and `DomainResponse` carries `correlationId = encodeULID(eventId)` with tenant/user/bot hashed into span attributes (not the ID) so traces remain stable even if timezone logic changes.
- **Policy guards:** AI layer enforces per-user/per-tenant budgets (max tokens/day, cost caps). When limits are hit it returns `ActionRequired` errors so the core can notify humans instead of silently failing.
- **Domain metrics:** Emit counters/histograms for `event.handle.duration`, `ai.cost.tokens`, `repo.transition.conflict`, `nutrition.lookup.cacheHit`, etc., all tagged by tenant/user (hashed) to protect privacy.
- **Rate limiting:** Telegram adapter applies burst + sustained rate limits before invoking Nutribot. Nutribot itself keeps a per-user work queue to avoid overloading AI or storage; when queues grow, emit `Backpressure` events and temporarily downgrade flows to text-only.
- **Backpressure:** Long-running itemization/reporting can be offloaded to background workers. The core emits `DomainResponse.Acknowledge("Processing", severity="info")` plus a `SystemTrigger` schedule so the adapter can show progress while work completes asynchronously.
- **Graceful degradation:** Feature flag `features.enableSimplifiedParsing` lets ops disable image/vision/itemizer flows during incidents. Users receive `Acknowledge("High load, using simplified parsing")` plus a text-only fallback so expectations stay aligned.

## 8. Decisions on previously open questions

### 8.1 AI-heavy flow execution model
- **Decision:** Async-first for GPT/AI work; launch requirement for Telegram is “fully async from day one,” with only a guarded inline fast-path for canaries.
- **Why:** Keeps webhook latency predictable, simplifies backpressure/cost control, and avoids a second UX/ops migration later.
- **Implementation:**
	1. On ingestion, core immediately emits `Acknowledge("Processing…")` or lightweight placeholder cards plus a `SystemTrigger` job (`ItemizeLog`, `SummarizeDay`, etc.).
	2. Adapter ACKs the webhook instantly, persists the placeholder, and enqueues the job on the per-tenant:user queue.
	3. Worker executes AI/itemizer/report steps out of band, then re-enters the core via `handle(SystemTrigger)` to update the cards.
	4. Config flag `features.enableInlineFastPath` exists for controlled experiments, default `false`; when enabled it only short-circuits the final render if the AI work already finished (no long blocking calls).
	5. Adapters always send the “Processing…” UX so there is no behavioral change when the flag toggles.

### 8.2 `handlePending` ownership
- **Decision:** Event-driven background worker owns itemization/reporting; inline logic restricted to enqueueing jobs. Add a periodic sweep for safety.
- **Flow:** Accept/portion actions enqueue `ItemizeLog(logUuid)`; worker performs CAS transitions (`accepted → itemizing → itemized`), calls itemizer, writes nutrilist entries, then debounces `SummarizeDay(user)` (30–60s, max 2 min). Nightly `SystemTrigger(Job=ReconcilePending)` retries stuck logs.

### 8.3 Timezone/day boundary changes
- **Decision:** Raw entries stay in UTC; no data migration. Derive `DayKey` at read time using `userPrefs`. When prefs change, mark aggregates/reports for last 14–30 days as stale and re-render asynchronously.
- **Details:** Store the timezone/dayStart used for each report snapshot. Day buckets use IANA tz inclusive/exclusive windows so DST anomalies are handled by the library. Backfill jobs recompute affected aggregates and nudge report cache.

### 8.4 Barcode lookup layering
- **Decision:** Model barcode lookup as a dedicated `NutritionProvider` port (parallel to AI), not part of `DataAccess`.
- **Implementation:** `NutritionProvider.lookup(upc)` returns normalized product data. Wrap provider with caching decorator: in-memory LRU (TTL≈15m) + persistent cache (TTL≈7–30d with ETag support). Nutribot composes provider output with `ClassifierAI` to add icons/noomColor so the provider stays transport-neutral.

### 8.5 Self-serve identity linking
- **Decision:** Deny unknown Telegram IDs by default and immediately show the token-based `/link <TOKEN>` wizard; prod never auto-registers, dev can via feature flag.
- **Flow:** Admin/CLI issues signed token (tenant, userName, expiry). Unknown user receives a single response: “Invite-only. Reply `/link <TOKEN>` to connect.” Buttons include “Request access” (pings admins) and “Help”. Adapter verifies HMAC-SHA256 signature, 30–60 minute TTL, and single-use via a consumed-token store keyed by token hash. On success it binds `telegram_user_id ↔ userName`, logs audit entry, confirms link, and rate-limits repeated unknown messages. `/unlink USER` admin command revokes mappings. Optional web-based linking can arrive later.

### 8.6 Report adjustment scope
- **Decision:** Launch supports adjustments on the latest report/day only; historical adjustments arrive later behind a dedicated intent.
- **Why:** Keeps cursors simple, reduces recompute churn, and aligns with the majority of current usage.
- **Implementation:** Cursor keys include scenario + current `dayKey`. `AskChoice` buttons surface “Adjust another day” only when the feature flag is enabled; when invoked, Nutribot explicitly sets the cursor `dayKey` (last 7–14 days) before reusing the same flows.

### 8.7 Revision semantics when day changes
- **Decision:** Post-itemization revisions become a new draft that supersedes the prior log; accepting the revision performs delete-then-insert even if the day changes.
- **Why:** Preserves auditability and ensures aggregates stay accurate without ambiguous partial moves.
- **Implementation:**
	1. New draft stores `supersedes = oldLogUuid` and starts in `draft`.
	2. CAS the old log `itemized → revising`; when the revision is accepted, delete nutrilist rows for the old log, insert rows for the new log, and transition old log to `closed` while the new log advances `itemizing → itemized`.
	3. Later optimization can detect “date-only” moves and perform targeted row moves instead of delete/insert.

### 8.8 Cursor tenancy keys
- **Decision:** Cursor keys include `(tenant, user, bot, scenario[, dayKey])` to isolate multi-bot/family contexts.
- **Why:** Prevents collisions when users run Nutribot via multiple transports or shared household bots, and future-proofs shared accounts.
- **Implementation:** CursorRepo key format `tenant:user:bot:scenario[:dayKey]`; payload stores `version` and metadata. All writes use `setIfUnchanged` to avoid races.

## 9. Follow-up alignment questions
All previously open items are now resolved in Sections 8.1 and 8.5–8.8; no outstanding alignment questions remain for this iteration. Use this section for future questions as they surface.

## 10. Appendix — Week‑1 TypeScript skeleton
Reference snippet to unblock implementation of the contracts and service shell:

```ts
// results.ts
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

// events.ts
export type DomainEventType =
	| 'MealTextLogged' | 'MealImageLogged' | 'BarcodeCaptured'
	| 'UserChoiceCommitted' | 'IntentInvoked' | 'SystemTrigger';

export interface DomainEvent {
	id: string; // ULID
	type: DomainEventType;
	actor: string; bot: string; tenant: string;
	occurredAt: string; // ISO UTC
	payload: Record<string, unknown>;
	sourceRef?: string; // transport-native, for idempotency
	cursorTokens?: string[];
}

// responses.ts
export interface BaseResponse {
	responseId: string;
	version: number;
	schemaHash: string;
}

export type DomainResponse =
	| (BaseResponse & { kind: 'SendCard'; cardKind: string; cardKindVersion: string; model: unknown; cardRef?: string; ttlSeconds?: number })
	| (BaseResponse & { kind: 'UpdateCard'; cardRef: string; cardKindVersion: string; model: unknown })
	| (BaseResponse & { kind: 'DeleteCard'; cardRef: string })
	| (BaseResponse & { kind: 'AskChoice'; cardRef: string; options: ActionOption[] })
	| (BaseResponse & { kind: 'AskInput'; cardRef: string; prompt: string; inputKind: 'text' | 'number'; cursorKey?: string })
	| (BaseResponse & { kind: 'PublishReport'; reportModel: ReportModel; layoutVersion: string; assetRef?: AssetRef; sizeLimitKb?: number })
	| (BaseResponse & { kind: 'SetCursor'; key: string; value: unknown; versionToken?: string })
	| (BaseResponse & { kind: 'ClearCursor'; key: string; versionToken?: string })
	| (BaseResponse & { kind: 'Acknowledge'; message: string; severity?: 'info' | 'warn' | 'error'; code?: string });

export interface ActionOption { actionId: string; label: string; args?: Record<string, unknown>; }

export interface JobDescriptor {
	job: 'ItemizeLog' | 'SummarizeDay' | 'ReconcilePending' | 'CleanupCards' | 'RenderReport';
	args: Record<string, unknown>;
	idempotencyKey: string;
	notBefore?: string;
}

// repos.ts
export type NutrilogStatus = 'draft' | 'accepted' | 'itemizing' | 'itemized' | 'revising' | 'revised' | 'discarded' | 'archived';
export interface Nutrilog { uuid: string; status: NutrilogStatus; actor: string; bot: string; tenant: string; sourceRef?: string; date: string; time?: string; food: BasicFoodItem[]; schemaVersion: number; updatedAt: string; updatedBy: string; }
export interface NutrilogRepo {
	createDraft(d: Omit<Nutrilog,'status'|'schemaVersion'|'updatedAt'|'updatedBy'>): Promise<Result<Nutrilog, RepoError>>;
	transitionStatus(uuid: string, from: NutrilogStatus, to: NutrilogStatus): Promise<Result<void, RepoError>>;
	findBySourceRef(tenant: string, user: string, sourceRef: string): Promise<Nutrilog | null>;
	listPending(tenant: string, user: string, range: DateRange): Promise<Nutrilog[]>;
}

export interface NutrilistRepo {
	replaceForLog(logUuid: string, items: EnrichedItem[]): Promise<Result<void, RepoError>>;
	listByRange(tenant: string, user: string, range: DateRange): Promise<EnrichedItem[]>;
	aggregate(tenant: string, user: string, range: DateRange): Promise<NutriAggregate>;
}

export interface CursorRepo {
	get(key: string): Promise<{ value: any; version: string } | null>;
	set(key: string, v: any): Promise<void>;
	setIfUnchanged(key: string, expectedVersion: string, next: any): Promise<Result<void, RepoError>>;
	delete(key: string): Promise<void>;
}
export type RepoErrorFamily = 'NotFound' | 'Conflict' | 'TransientIO' | 'Validation';
export interface RepoError { family: RepoErrorFamily; message: string; details?: any; }

// ai.ts
export type AIErrorFamily = 'Transient' | 'Permanent' | 'ActionRequired';
export interface AIError { family: AIErrorFamily; message: string; details?: any; }
export interface FoodTextAI { analyze(text: string, ctx: AIContext): Promise<Result<FoodLogDraft, AIError>>; }
export interface FoodVisionAI { analyze(imageRef: string, ctx: AIContext): Promise<Result<FoodLogDraft, AIError>>; }
export interface ItemizerAI { enrich(items: BasicFoodItem[], ctx: AIContext): Promise<Result<EnrichedItem[], AIError>>; }
export interface ClassifierAI { classify(label: string): Promise<Result<{ icon: string; noomColor: string }, AIError>>; }
export interface CoachAI { generate(ctx: CoachingContext): Promise<Result<CoachingTip, AIError>>; }
export interface NutritionProvider { lookup(upc: string): Promise<Result<UPCProduct, ProviderError>>; }

// renderer.ts
export type AssetRef = { kind: 'buffer' | 'file' | 'url'; mime: string; bytes?: Uint8Array; path?: string; url?: string; };
export interface ReportRenderer { render(model: ReportModel): Promise<Result<AssetRef, RenderError>>; }

// service.ts
export class NutribotService {
	constructor(private repos: { logs: NutrilogRepo; list: NutrilistRepo; cursor: CursorRepo },
							private ai: { text: FoodTextAI; vision: FoodVisionAI; itemizer: ItemizerAI; coach: CoachAI },
							private nutrition: NutritionProvider,
							private renderer: ReportRenderer,
							private clock: Clock,
							private logger: Logger,
							private coordination?: CoordinationPort) {}

	async handle(ev: DomainEvent): Promise<{ responses: DomainResponse[]; jobs: JobDescriptor[] }> {
		switch (ev.type) {
			case 'MealTextLogged':
				return this.onMealText(ev);
			case 'UserChoiceCommitted':
				return this.onChoice(ev);
			default:
				return {
					responses: [{ kind: 'Acknowledge', version: 1, schemaHash: 'ack-v1', responseId: crypto.randomUUID(), message: 'Unsupported event', severity: 'warn' }],
					jobs: []
				};
		}
	}

	private async onMealText(ev: DomainEvent): Promise<{ responses: DomainResponse[]; jobs: JobDescriptor[] }> {
		return { responses: [], jobs: [] };
	}

	private async onChoice(ev: DomainEvent): Promise<{ responses: DomainResponse[]; jobs: JobDescriptor[] }> {
		return { responses: [], jobs: [] };
	}
}
```

This design enforces a clean separation where Nutribot becomes a pure domain engine powered by injected AI/storage/rendering services, enabling both Telegram and non-Telegram clients (e.g., Slack, CLI, automated ingestion) plus deterministic tests.

## 11. Module layout (current repo files)

| File | Scope | Notes |
| --- | --- | --- |
| `backend/chatbots/nutribot/nutribotRouter.mjs` | Express router that mounts `/webhook`, `/report`, `/report/img`, `/coach`, and health endpoints. | Owns middleware (`requestLogger`, JSON parsing), delegates Telegram posts to the adapter, and exposes manual triggers for ops/testing. Can be rewritten, but must continue exporting a router consumed by the global server. |
| `backend/chatbots/nutribot/nutribotTelegram.mjs` | Transport adapter translating Telegram updates ↔ `DomainEvent`/`DomainResponse`. | Parses webhook payloads, maps identities via config, persists cursor tokens, renders inline keyboards, and pushes outbound actions. Reads from the adapter outbox and enqueues jobs after core responses. |
| `backend/chatbots/nutribot/nutribotCore.mjs` | Nutribot core orchestration (`NutribotService`) plus helper factories. | Pure functions that accept injected repos/AI/renderers and return `{ responses, jobs }`. Hosts domain handlers (`onMealText`, `onChoice`, `onSystemTrigger`, etc.) and enforces state-machine invariants. |
| `backend/chatbots/nutribot/nutribotAI.mjs` | AI service implementations and fakes. | Wraps vendor SDKs (OpenAI today) for `foodText`, `foodVision`, `itemizer`, `coach`, `classifier`; enforces timeouts/cost caps; exposes deterministic fixtures for `_test`. |
| `backend/chatbots/nutribot/nutribotData.mjs` | Data access layer adapters. | Provides concrete `NutrilogRepo`, `NutrilistRepo`, `CursorRepo`, `ReportRepo`, `CoachRepo` implementations backed by current YAML/JSON files, while hiding persistence details from the core. Future Postgres adapters live here too. |
| `backend/chatbots/nutribot/nutribotUPC.mjs` | NutritionProvider port + caching decorators. | Performs UPC/barcode lookups (Spoonacular/OFF/etc.), applies per-tenant caches, and normalizes payloads before returning to the core. |
| `backend/chatbots/nutribot/_test/test.mjs` | Deterministic harness. | Imports the contracts/core and runs golden scenarios that stub out adapters, ensuring CLI/CI coverage without Telegram/OpenAI dependencies. |

This layout keeps transports, orchestration, AI, persistence, and nutrition lookups isolated while giving a clear home for upcoming TypeScript contract files (Week‑1 deliverables can land next to these modules or in a `lib/` subfolder).

