# Overheard Decisions (Wearable Capture)

**Status:** Proposed. No Bee device owned yet; phases 1–3 run on fixtures until one arrives.
**Created:** 2026-09-22
**Owners:** Household integrations, Economy, Arcade sessions, School
**Deadline driver:** Amazon Developer Hackathon, Bee (Wearable AI) track. Submissions close
2026-10-23 12:00 PT ([resources](https://amazonappdev2026.devpost.com/resources),
[rules](https://amazonappdev2026.devpost.com/rules)).
**Decision:** A standalone, MIT-licensed service turns decisions a parent says out loud into
pending household actions, one tap confirms them, and Daylight is its first set of sinks.
It is built against fixtures now and switched to live Bee data the day the device arrives.
The extractor calls the existing `IAIGateway` port; a new Bedrock adapter behind that port
serves this feature, and any other gateway consumer that opts in.
Wearables sit behind one vendor-neutral port (`IWearableSource`, §5). Bee is the first
adapter; Fieldy is the second, after the hackathon. Nothing above `1_adapters/` knows which
device heard the words.

---

## 1. Summary

Parents make household decisions out loud all day, and almost none of them reach the
system that is supposed to enforce them:

- "Fine, thirty more minutes of Mario." The arcade budget still says no.
- "That's five coins for unloading the dishwasher." The coin ledger never hears it.
- "We finished chapter five of *Hatchet*." The reading log stays on chapter four.

Bee is a wrist-worn microphone that transcribes the wearer's day in Bee's cloud and
exposes it to developers through a CLI, an HTTP API, a live event stream and an MCP
server. This roadmap listens to that stream, picks out the small set of utterances that are
household decisions, turns each into a proposed action, asks the wearer to confirm it with
one tap, and writes it to the ledger it belongs to.

Nothing is enforced on a transcript alone. Every action waits for a tap from the wearer.

Bee is the first device because the hackathon's Bee track drives the timeline, but the
feature is not Bee-specific. Wearable recorders such as Bee and Fieldy end in the same
place: timestamped, speaker-labelled transcript text in a vendor cloud. A shared capture
layer (§5) normalizes them, so the decision engine, the lifelog harvester and Journalist
consume one stream whichever device the household owns.

### Why Bee, and not Alexa or Telegram

For commands someone *means* to give, Telegram and Alexa are better: they are precise,
fast, and can answer back. Bee has no speaker and its latency is unmeasured. The one thing
Bee does that neither can is hear decisions nobody would stop to enter. This roadmap uses
Bee only for that.

---

## 2. What Bee provides

Verified from the developer docs, the `bee-cli` source, Bee's product pages and published
reviews (sources in §13).

### Architecture

```
wristband ──BLE──▶ Bee iPhone app ──▶ Bee cloud (Amazon) ──▶ developer API
                                      transcription, summaries,
                                      facts, todos all happen here
```

- Entirely cloud-processed. Nothing runs on the phone; on-device models are a stated future
  plan. Audio is discarded after transcription; only text and derived data exist.
- No LAN or device-level access. All data comes from the cloud API.
- Live capture needs the phone within Bluetooth range and online. Out of range, the
  wristband buffers recordings and uploads them later.

### Three clocks

| Output | Arrives | Evidence |
|---|---|---|
| Live utterances (`new-utterance`, `realtime: true`) | During the conversation; seconds unknown | SSE stream in `bee-cli` (`sources/commands/stream/index.ts`); a captured 2025 API payload showing a conversation in state `CAPTURING` already holding live utterances with `spoken_at` timestamps |
| Processed conversation (summary, suggested todos, facts) | After the conversation ends: 15 min of silence by default, or on a double-press | Product page; captured payloads show conversations lasting 17 min to ~4 h |
| Daily summary | Nightly, around 8 PM | The Verge review |

Each conversation is transcribed twice. The live pass (`realtime: true`) is a draft; the
final pass (`realtime: false`) replaces it, and the CLI prefers the final one.

**No public source measures live-stream latency.** Other entries in this hackathon
(`usv240/bellwether`, `AtchayamG/bee-bystander`) list it as unmeasured. Measuring it is a
phase 4 deliverable and part of the submission.

### Other limits that shape the design

- **No speaker identity.** Utterances are labelled `speaker_1`, `Unknown`, or `"0"`/`"1"`.
  There is no flag for the wearer. A child's voice or the TV can say "you can have thirty
  minutes" as easily as the parent can.
- **The stream is at-most-once.** Events sent while disconnected are lost. Completeness
  comes from `/v1/changes` with a saved cursor.
- **Voice notes are a separate, cleaner channel.** Hold the button and speak; the note
  streams as `journal-text` and arrives cleaned up (`aiResponse.cleanedUpText`).

### Authentication

- Developer Mode: Bee iOS app → Settings → tap Version five times.
- `bee login` generates a key pair and prints a `bee.computer/connect#…` link. Approving it
  in the app returns a token encrypted to the CLI's key.
- The token is stored in the OS keychain, or in `~/.bee/` where there is none. The CLI has
  no refresh logic; token lifetime is undocumented.
- Direct API calls need the bearer token and Bee's private CA certificate, which the CLI
  bundles.

---

## 3. Goals and non-goals

### Goals

- Detect three decision kinds in live Bee data: arcade time grants, coin credits, reading
  progress.
- Every detected decision becomes a pending action that the wearer confirms or dismisses
  with one tap.
- Confirmed actions land in the real Daylight ledgers and show up on the surface they
  affect.
- Work on either clock: act on live utterances if the stream is fast; reconcile against the
  final transcript once the conversation is processed.
- A standalone repo that anyone with a Bee can run without Daylight, using its own simple
  ledger.
- A vendor-neutral capture layer (§5), so a second wearable is one new adapter and nothing
  else.
- Measure and publish Bee live-stream latency.

### Non-goals

- Voice control. Explicit commands stay on Telegram and, later, Alexa.
- Acting without confirmation, ever.
- Building speaker identification. The tap is the identity check; a source's own wearer
  flag (Fieldy) is used only as a filter.
- Piano game grants or State Gates overrides (no primitive exists yet; see §7).
- Storing raw utterances anywhere outside the vendor's cloud. Only decisions and their evidence
  excerpts are kept.

---

## 4. The flow

```
Bee cloud ──/v1/stream, /v1/changes──▶ bee proxy ──▶ BeeWearableSource    ─┐
Fieldy cloud ──webhook POST, REST────────────────▶ FieldyWearableSource ─┤  (§5)
                                                                           ▼
                                                    WearableCaptureService
                                                    dedupe · checkpoints · draft→final
                                                                           │ utterances.captured
                                                                           ▼
                     ┌─ 1. INTAKE    subscribe to normalized wearable events
                     ├─ 2. GATE      cheap keyword filter: minutes, coins, chapter, page…
                     ├─ 3. EXTRACT   LLM on a short window around the hit → typed decision
                     ├─ 4. PROPOSE   pending action with a readable sentence + evidence excerpt
                     ├─ 5. CONFIRM   push to the wearer: Approve / Dismiss
                     ├─ 6. APPLY     sink write (Daylight route or standalone ledger)
                     └─ 7. RECONCILE on processed conversation: compare against the final
                                     transcript, flag mismatches, never silently reverse
```

The keyword gate in step 2 matters for cost and speed. Almost nothing a family says is a
decision, and the LLM should only see the few windows that might be.

### Extraction through `IAIGateway`

Step 3 depends only on the port in `backend/src/3_applications/common/ports/IAIGateway.mjs`,
calling `chatWithJson` with the utterance window, the household roster and the decision
schemas. It does not know which provider answers.

The provider for this feature is a new `BedrockAdapter` in `backend/src/1_adapters/ai/`,
shaped like `AnthropicAdapter`:

- Implements `chat`, `chatWithJson` and `isConfigured` through the Bedrock Converse API,
  so the model (Claude on Bedrock, Amazon Nova, …) is a config value, not code.
- `chatWithImage` is optional for v1. `transcribe` and `embed` throw "not supported", as
  `AnthropicAdapter` does; Bee already delivers text.
- Costs go through `aiPricing.mjs` and the usage ledger like the other adapters, so Bedrock
  spend shows up alongside OpenAI spend.
- Credentials are AWS keys in household auth, read the same way the OpenAI key is. The
  hackathon offers $150 in AWS credits.

OpenAI stays the default provider for everything else. Only the decision extractor is
wired to Bedrock, which keeps the change reversible and gives the AWS Builder mini
challenge a documented integration.

### Decision types (v1)

| Kind | Example | Extracted fields | Sink |
|---|---|---|---|
| `arcade.grant` | "Fine, thirty more minutes of Mario" | learner, minutes, (game) | arcade grants |
| `coins.credit` | "That's five coins for the dishes" | learner, amount, reason | coin deposit |
| `reading.progress` | "We finished chapter five of *Hatchet*" | learner, book, chapter/page | reading log entry |

Learner resolution uses names spoken in the window plus the household roster. When it is
ambiguous, the push asks ("Kid A or Kid B?") instead of guessing.

When a source reports `speaker.isWearer === false`, a grant-type decision is dropped before
it reaches the phone: someone other than the wearer said it. `null` (Bee, always) and
`true` both proceed to confirmation. The tap is required in every case.

### Confirmation

The push follows `docs/reference/notifications/push-standard.md`: display names, spoken
local times, a `tag` per decision so a re-detection replaces the card instead of stacking.

> **Arcade time for Kid A?** +30 min of Mario tonight. Heard at 6:42 PM: "fine, thirty more
> minutes."  [Approve] [Dismiss]

Approved actions also show a toast on the affected screen when one exists (§7 gap 2).

---

## 5. Wearable capture abstraction

Vendor details stay in `1_adapters/`. Everything above that layer sees one normalized
stream, so a household can switch or add devices without touching the decision engine,
and other consumers (lifelog harvester, Journalist) get wearable data for free.

### Why an abstraction is needed

Bee and Fieldy differ on almost every axis that matters to an ingestion pipeline:

| | Bee | Fieldy |
|---|---|---|
| Live delivery | **Pull.** Outbound SSE (`/v1/stream`) held open by the consumer | **Push.** Fieldy POSTs processed batches (`transcriptions.processed`) to a public URL |
| Catch-up | `/v1/changes` with an opaque cursor | REST by time range (`/api/public/v2/transcriptions?startTime&endTime`), 30 req/min, no cursor |
| Transcript quality | Live draft (`realtime: true`), replaced by a final pass | Already processed on arrival; no draft |
| Speaker | `speaker_1` / `Unknown`; no wearer flag | Letter labels (`"A"`); speaker profiles recognize the wearer |
| Time | `spoken_at`, wall clock | `timestamp`, wall clock; `start`/`end` are audio offsets, not times |
| Event identity | None on stream events | `x-fieldy-event-id` header |
| Auth | `bee login` pairing; token held by the CLI proxy | API key (`sk-fieldy-…`); personal webhook is **unsigned** |
| Voice notes | Yes (`journal-*`) | No separate channel |
| Conversation end | Stream `update-conversation` → processed | `conversation.completed`, organization webhook only |

### Layers

```
2_domains/wearables/
  CapturedUtterance     { source, key, conversationKey, text, spokenAt,
                          speaker: { label, isWearer: true|false|null },
                          quality: 'draft'|'final' }
  CapturedConversation  { source, key, startedAt, endedAt,
                          state: 'capturing'|'processing'|'final', title?, summary? }
  CapturedVoiceNote     { source, key, text, capturedAt }

3_applications/wearables/
  ports/IWearableSource.mjs            ← every vendor adapter implements this
  ports/IWearableCheckpointStore.mjs   ← per-source checkpoint + seen keys
  WearableCaptureService.mjs           ← one ingestion pipeline for all sources

1_adapters/wearables/
  bee/BeeWearableSource.mjs            ← stream + /v1/changes through bee proxy
  fieldy/FieldyWearableSource.mjs      ← webhook parsing + time-range REST

4_api/v1/routers/wearables.mjs         ← POST /api/v1/wearables/:sourceId/webhook
```

`3_applications/ambient/` already exists (the ambient task scheduler), hence `wearables`.

### The port

```js
export class IWearableSource {
  get id() {}                      // 'bee' | 'fieldy'
  capabilities() {}                // { live: 'stream'|'webhook'|'none',
                                   //   catchUp: 'cursor'|'timeRange',
                                   //   wearerIdentity, voiceNotes, draftTranscripts }

  async startLive(onEvents) {}     // stream sources; webhook sources: no-op
  async stopLive() {}

  parseWebhook(headers, body) {}   // webhook sources → WearableEvent[]; throws on bad auth

  async fetchSince(checkpoint) {}  // → { events, nextCheckpoint }; checkpoint is opaque
                                   //   (Bee: cursor string; Fieldy: time watermark)

  async getConversation(key) {}    // final transcript, for reconciliation
}
```

Every source emits the same events: `utterances.captured` (a batch),
`conversation.updated` / `conversation.finalized`, and `voiceNote.captured`. A source that
cannot produce one says so in `capabilities()`; consumers check capabilities, never
`source.id`.

### `WearableCaptureService`

Owns what each vendor gets wrong in its own way:

- **Deduplication.** Bee's stream is at-most-once and Fieldy retries webhooks. Each event
  carries a stable `key`: Fieldy's event ID, or for Bee a hash of conversation, time and
  text. Seen keys are dropped.
- **Checkpoints.** Saved only after a batch is processed, so a crash replays instead of
  losing. Catch-up runs on startup and on a timer, inside each source's rate limit.
- **Draft → final.** When a final transcript supersedes a Bee draft, it re-emits with
  `quality: 'final'` and consumers reconcile (§4 step 7). Fieldy never emits drafts.
- **One output.** Normalized events go onto the event bus. Consumers subscribe there and
  never import a vendor adapter.
- **Observability.** Structured events per source: `wearables.batch.received`,
  `wearables.duplicate.dropped`, `wearables.checkpoint.saved`, `wearables.catchup.gap`
  (events found by catch-up that the live path missed). The last one is how stream loss
  gets measured. Utterance text is never logged.

### Webhook exposure (Fieldy)

Bee is pull-only; nothing new is reachable from outside. Fieldy's personal webhook needs a
**public inbound URL** and has **no signing secret** (Fieldy's docs say so), so the only
proof of origin is a long secret in the URL, which Fieldy sends as a query parameter. That
breaks the "no new external path" posture in §7, so the Fieldy adapter ships only with:

- a per-source secret of at least 32 random bytes, compared in constant time, stored in
  household auth and never logged (the router strips it before logging the request);
- a dedicated Cloudflare rule that exposes only `POST /api/v1/wearables/fieldy/webhook`;
- rate limiting and a body size cap on that route;
- the organization webhook (HMAC-SHA256 signed) preferred if a Fieldy organization account
  is ever set up.

---

## 6. Standalone repo vs Daylight

| Piece | Standalone repo | Daylight |
|---|---|---|
| Wearable capture port, service, Bee adapter (§5) | yes | same code; Daylight wires it to the event bus |
| Fieldy adapter | after the hackathon | after the hackathon |
| Gate, extractor, decision model | yes | — |
| Pending actions + confirmation | yes (ntfy or webhook push) | Home Assistant push, DoNow-style approval |
| Ledger | built-in JSON/YAML ledger + small web page | arcade grants, coin deposit, reading log |
| Fixtures + replay harness | yes | — |
| LLM provider | `IAIGateway` port + `BedrockAdapter`, carried over | same port; Bedrock adapter lives here first |

Daylight connects as a sink plugin that calls its existing HTTP routes. The standalone repo
must run end to end without Daylight, so judges can use it, and so Daylight does not
become a fork of it.

### Running the Bee side

`bee proxy --socket` (or `--port`) runs in a small sidecar container next to whichever
process consumes it. The proxy has no authentication and binds to localhost only. It must
never be exposed beyond the host. The CLI holds the token and the CA certificate; the
consumer never sees either.

---

## 7. Daylight endpoints

Mapped 2026-09-22. All paths are under `/api/v1`.

| Need | Route | State |
|---|---|---|
| Add arcade minutes | `POST /arcade-game-sessions/grants` `{userId, minutes, by, reason}` (negative revokes) | exists |
| Read arcade grants | `GET /arcade-game-sessions/grants/:userId?on=` | exists; no single "remaining minutes" read |
| Credit coins | `POST /economy/users/:userId/deposit` `{amount, note}` | exists |
| Log reading progress | `POST /school/teacher/learners/:learnerId/reading/:readingId/entries` | exists; needs the teacher gate (PIN or teacher session) |
| Learner roster | `GET /school/roster`, `GET /piano/users` | exists |
| Parent push | `POST /home-automation/ha/call` with `notify.*` | exists; composer helpers in `2_domains/notification/push/pushText.mjs` |
| Approval with Approve/Deny actions | DoNow `HaApprovalNotifier` pattern | exists for DoNow only; 120 s default TTL |

### Gaps to build

1. **General spoken-decision approval.** Reuse the DoNow approval pattern, with a TTL long
   enough to survive an unknown stream delay (proposed: 30 min, then the card expires).
2. **Screen toast endpoint.** The screen framework already has toast and overlay slots fed
   by WebSocket topics (`docs/reference/core/screen-framework.md`). Add an HTTP route that
   publishes to a configured topic, so a confirmed grant can show "Kid A: +30 min" on the
   arcade screen.
3. **Reading-log service credential.** The teacher gate is built for a person at a screen.
   The sink needs a way to write an entry on the confirmed approval of a teacher, recorded
   with `by` set to that approver.
4. **Coin debit** (deferred). The ledger supports `withdraw`, but no route does. Needed only
   when "that costs you five coins" becomes a decision type.

### Security posture

Many write routes, including arcade grants and coin deposits, have no auth beyond the LAN
rule and the external IP allowlist; a LAN caller is treated as sysadmin. This roadmap does
not widen that: the Bee service runs on the homeserver LAN and opens no new external path.
The Fieldy adapter is the one exception, and it ships only with the controls in §5
("Webhook exposure"). Tightening the existing routes is its own piece of work because kiosks
depend on them.

---

## 8. Privacy

- Bee records everyone near the wearer, including children. The service never writes raw
  utterances to the log store. It logs decision events and a short evidence excerpt only.
- Evidence excerpts are kept with the decision so a parent can see why it was proposed, and
  are deleted with it.
- The demo video uses a staged scene, not real household audio.

---

## 9. Phases

| Phase | Window | Work | Exit |
|---|---|---|---|
| 0 | Sep 22 | Order a Bee (iPhone required). Create the standalone repo with MIT license. Start the friction log. | Device on order; repo public |
| 1 | Sep 22 – Oct 2 | Fixtures from documented payloads and the captured 2025 sample. `2_domains/wearables` types, `IWearableSource` + `IWearableCheckpointStore` ports, `WearableCaptureService` (dedupe, checkpoints, draft→final), `BeeWearableSource` on fixtures, gate, extractor, decision model, standalone ledger, replay harness. `BedrockAdapter` behind `IAIGateway`, with unit tests against a stubbed HTTP client. Tests on fixtures. | A replayed fixture day produces the expected pending decisions, extracted through Bedrock |
| 2 | Sep 29 – Oct 6 | Confirmation push (standalone: ntfy; Daylight: HA). Daylight sinks for the three decision types. Gaps 1–3 in §7. | Approving a fixture decision changes the real arcade grant, coin balance and reading log |
| 3 | Oct 2 – Oct 9 | Reconciliation against processed conversations. Standalone web page listing pending and applied decisions. | A draft-vs-final mismatch is flagged, never silently reversed |
| 4 | Device arrival (target ~Oct 6) | `bee login` on the homeserver sidecar. Latency measurement: timestamped `new-utterance` events against spoken phrases, phone unlocked vs locked vs app backgrounded. Tune the gate on real transcripts. | Published latency numbers; live decisions flowing |
| 5 | by Oct 20 | Demo video (< 3 min), README setup and run instructions, product feedback, friction log, feature requests. | Submitted with three days of buffer |
| 6 | after Oct 23 | `FieldyWearableSource`: webhook parsing, time-range catch-up within 30 req/min, `isWearer` from speaker profiles. Webhook route with the §5 exposure controls. Needs a Fieldy device (~$129). | The same fixture day, replayed as Fieldy payloads, produces the same decisions as the Bee replay |

If the device slips past about Oct 13, fall back to an Apple Watch running Bee software,
which the rules accept.

---

## 10. Hackathon fit

- **Track:** Bee. Priorities are education, developer experience and personal
  productivity. This covers productivity (household ledgers) and education (reading
  progress).
- **"Creative" examples it hits:** ambient context capture that informs a productivity
  workflow; real-time functionality; cross-device orchestration (wristband → phone push →
  arcade screen).
- **Runtime requirement:** Bee is called in code through the proxy and stream, not only
  named in the README.
- **Differentiator:** the only entry with measured live-stream latency and device-behaviour
  notes.
- **Mini challenges:** Open Source (the standalone repo). AWS Builder: the extractor runs on
  Amazon Bedrock through `BedrockAdapter`; the product feedback names the service and model.
- **Bonus:** friction log entries score up to 10%. The first entry already exists:
  `docs.bee.computer/docs`, linked as "Get Started", returns 404.

---

## 11. Open questions

1. Live-stream latency, and whether events arrive per sentence or in bursts. Phase 4.
2. Whether live events keep flowing with the iPhone locked or the Bee app backgrounded.
3. How long a `bee login` token lasts, and what the CLI does when it expires.
4. ~~Extractor model provider.~~ Decided: `IAIGateway` with a new `BedrockAdapter` (§4).
   Still open: which Bedrock model. Pick on fixture accuracy and latency in phase 1.
5. Gate recall. The keyword list is written against fixtures and has to be tuned on real
   transcripts; missed decisions are worse than extra LLM calls.
6. Where the standalone repo lives and what it is called.
7. Bee utterance keys. Stream events carry no ID, so the dedupe key is a hash; confirm it
   stays stable between the live event and the same utterance returned by catch-up.
8. Whether Fieldy's `speaker` label is already the matched wearer by the time
   `transcriptions.processed` fires, or only after later speaker matching (its docs say
   manual recordings do not wait for matching).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Device arrives late | Order now; Apple Watch fallback; all non-device work finished on fixtures |
| Stream latency is minutes, not seconds | Confirmation-by-tap works at any latency; the demo shows the processed-conversation path too |
| False decisions from TV audio or children | Nothing applies without the wearer's tap; dismissals are logged to tune the gate |
| Missed decisions | Reconciliation pass over processed conversations proposes anything the live pass missed |
| Bee API changes | Everything goes through the CLI's proxy, which tracks the API |
| Abstraction shaped around one vendor | Fixture tests run the same decision day through Bee- and Fieldy-shaped payloads before the Fieldy adapter exists |
| Fieldy webhook is unsigned and public | §5 controls; prefer the signed organization webhook if available |

---

## 13. Sources

- Bee developer docs: realtime, proxy/API, MCP, sync, agentic sync, skill, developer mode
  (docs.bee.computer)
- `bee-computer/bee-cli`: stream (`sources/commands/stream/index.ts`), conversations
  (`sources/resources/conversations/index.ts`), login and token storage
  (`sources/commands/login/index.ts`, `sources/secureStore.ts`), API host
  (`sources/environment.ts`)
- `bee-computer/bee-skill` (`bee-cli/SKILL.md`)
- Bee product page and FAQ (bee.computer/bee-pioneer)
- Amazon, "Building Bee at Amazon" (2026-01-05)
- TechCrunch hands-on (2026-01-12) and review (2026-05-24); The Verge review (2025-03-12);
  Wired on always-listening wearables; Gadget Gram review
- GitHub integrations: `andresgomezsar/OllamaCognos` (captured API payloads),
  `johnwils/kept`, `joshuaswarren/remnic`, `usv240/bellwether`, `AtchayamG/bee-bystander`,
  `brookejamieson/reinvent-notetaker`, `FinestDice17/bee-homeassistant-addon`
- Fieldy: product page (shop.fieldy.ai), developer docs (fieldyai.github.io/docs: MCP,
  public API, webhooks), API reference (api.fieldy.ai/docs), app guide and help-center
  articles on webhooks and the public API
