# NFC play-next: URL fallback mis-parses query → wrong content resolved, nothing plays

**Reported:** 2026-07-07 (user asked "did the last NFC tag scan work?")
**Severity:** High — registered NFC book tags dispatch successfully end-to-end on the backend, report `ok: true`, and then play **nothing**. The screen is left with a Player overlay stuck on "Loading…" indefinitely.
**Status:** Fully landed on `main` as of 2026-07-10 (see `docs/_wip/plans/2026-07-07-nfc-play-next-url-fallback-fix.md`) — all 6 tasks done TDD, isolated suites green, frontend builds. The final refinement (watchdog no longer arms for menu/list opens, which would otherwise false-timeout since a browse never emits `playback.log`) was cherry-picked from the now-deleted `fix/nfc-play-next-url-fallback` branch. **Still pending: deploy + live verification on hardware.** Q1 (WS ack timeout despite fresh subscribers) still open.
**Related:** `2026-04-27-nfc-multi-scan-and-tv-off-mid-track.md` — the "scan a book 2-3 times before it takes" symptom is plausibly this bug: the first (cold/URL-delivered) scan silently plays nothing; a later re-scan that lands on the WS-delivery path works.

---

## Incident summary (2026-07-07, times = container local, UTC-7)

Tag `04_28_d4_71_cc_2a_81` ("Eyes shuts" → album `plex:621568`, *I Can Read with My Eyes Shut!*) was scanned at the livingroom reader at ~11:28:09.

| Time | Event | Meaning |
|---|---|---|
| 11:28:09 | `trigger.guard.suppressed` | Dispatch began; zombie-wake guard disabled 90 s |
| 11:28:15–33 | `wake-and-load.prepare.*` | Device prepare (~18 s) |
| 11:28:33.747 | `wake-and-load.load.ws-check` `{subscriberCount: 2, handlerFresh: true}` | WS-first delivery attempted |
| 11:28:37.778 | `wake-and-load.load.ws-failed` `{error: "waitForMessage timed out after 4000ms"}` | **No device-ack** → fall back to FKB URL |
| 11:28:37.779 | `fullykiosk.load.builtUrl` | URL: `/screen/living-room?scanned_at=2026-05-10+11:51:19&note=Eyes+shuts&play-next=plex:621568&op=play-next&endBehavior=tv-off&endDeviceId=livingroom-tv&endLocation=living_room` |
| 11:28:38.713 | `fullykiosk.load.acknowledged` | Kiosk loaded the URL (935 ms) |
| 11:28:38.715 | `trigger.fired` `{ok: true, elapsedMs: 29105}` | **Backend declares success** |
| 11:28:41.495 | `queue.source.unknown` `{compoundId: "scanned_at:2026-05-10 11:51:19", source: "scanned_at"}` | **Frontend resolved the WRONG param as content** → 404 |
| 11:28:49 | `fullykiosk.load.async-unverified` | FKB currentUrl never populated (secondary signal) |
| 11:29:38.767 | `proxy.timeout` `{service: "plex", timeout: 60000}` | Follow-on Plex proxy timeout (secondary) |
| 11:28 → hours later | `playback.overlay-summary` `status:Loading…` every 1 s from the Shield (waitKey `0031aca646`, `vis:7635056ms` at 13:35 ⇒ stuck since ~11:28) | Player overlay stuck on Loading with the bogus content id |

No `playback.log`, `track.start`, or any media event for `plex:621568` ever occurred. **The album never played.** There was also no `wake-and-load.playback.timeout` — the watchdog never armed (see Gap G1).

---

## Architecture context: two delivery paths for a trigger's content

`actionHandlers['play-next']` (`backend/src/3_applications/trigger/actionHandlers.mjs:44`) hands `wakeAndLoadService.execute(target, { ...intent.params, 'play-next': content, op: 'play-next' }, ...)`. WakeAndLoadService then delivers via:

1. **WS-first** (`WakeAndLoadService.mjs:447-523`): builds a `CommandEnvelope { command: 'queue', params: { op, contentId } }` where `contentId` is resolved via `resolveContentId()` / `CONTENT_ID_KEYS` (`contentIdKeys.mjs:9-18`) — which **does** know `play-next`. The frontend's `useScreenCommands` → `media:queue-op` → `ScreenActionHandler.handleMediaQueueOp` (`ScreenActionHandler.jsx:168-189`) handles this correctly. Gated on subscriber count + handler liveness + a 4 s device-ack wait.
2. **FKB URL fallback** (`WakeAndLoadService.mjs:533-538`): loads `/screen/living-room?<raw query>` onto the kiosk. The frontend's `ScreenAutoplay` (`ScreenRenderer.jsx:52-132`) parses the query via `parseAutoplayParams` (`frontend/src/lib/parseAutoplayParams.js`) — which **does not** know `play-next`.

Path 1 timed out on ack in this incident (open question Q1 below), so path 2 — the safety net — was the actual delivery. The safety net is broken for `play-next`.

---

## Root causes

### RC1 (frontend, primary): `parseAutoplayParams` doesn't know `play-next`, and its alias fallback grabs the first unknown key

`frontend/src/lib/parseAutoplayParams.js`:

- `AUTOPLAY_ACTIONS` (line 17) = `['play','queue','playlist','random','display','read','open','app','launch','list']` — **no `play-next`** (nor `play-now`), and `ACTION_MAPPINGS` (line 45) has no entry either. The one param that carries the user's intent is invisible to the parser.
- The **alias fallback** (lines 123-128) then converts the *first* query param that isn't a `CONFIG_KEYS` entry and contains no `.` into `{ play: { contentId: '<key>:<value>' } }`. Param order in the URL is `scanned_at`, `note`, `play-next`, `op`, … — so it produced:

  ```js
  { play: { contentId: 'scanned_at:2026-05-10 11:51:19' } }
  ```

- `ScreenAutoplay` emitted `media:play` with that id; the Player mounted, requested the queue, and the backend queue router (`backend/src/4_api/v1/routers/queue.mjs:114-117`) correctly 404'd with `queue.source.unknown`. The Player then sat on "Loading…" forever.

**Important:** this is not merely a param-ordering accident. Even with a clean query (`?play-next=plex:621568&op=play-next&endBehavior=tv-off…`), the fallback would produce `contentId: 'play-next:plex:621568'` — also garbage. **The URL delivery path for `play-next` has never worked.** It only appears to work when the WS-first path succeeds.

Note `useInitialActionGate` (`frontend/src/screen-framework/hooks/useInitialActionGate.js`) shares `AUTOPLAY_ACTIONS`, so the menu-flash suppression gate also fails to engage for these URLs (cosmetic, but same root list).

### RC2 (backend): NFC tag *metadata* leaks into the device URL

`NfcResolver` (`backend/src/2_domains/trigger/services/NfcResolver.mjs`) builds `intent.params` from all merged tag keys that aren't in `RESERVED_KEYS` (lines 26-30, 104-110). The bookkeeping fields `scanned_at` and `note` — written by `YamlTriggerConfigRepository` on first scan — are not reserved, so they flow into `params` → `buildLoadQuery` → the FKB URL. Consequences:

- They're what the alias fallback latched onto (`scanned_at` came first).
- Freeform user text (`note=Eyes shuts`) is shipped in a device URL for no reason.
- They also pollute the shorthand-expansion candidate list (`expandShorthand`, lines 32-50) — harmless today only because `scanned_at:*`/`note:*` never resolve as content.

### Gap G1 (observability): the playback watchdog never arms for `play-next`

`WakeAndLoadService`:
- Watchdog arming is gated on `contentQuery.queue` (line 630) and `expectedContentId` only checks `prewarmContentId || contentId || queue || play || list` (lines 717-722) — **not `play-next`**, even though `CONTENT_ID_KEYS` knows it.
- Transcode prewarm is likewise gated on `contentQuery.queue` (line 314), so `play-next` content is never prewarmed.

Result: this failure mode produces `trigger.fired ok:true` and **no alarm at all**. The only traces are a `warn` from an unrelated-looking module (`queue.source.unknown`) and per-second overlay spam.

### Q1 (open question, contributing): why did WS-first ack-timeout despite `subscriberCount: 2, handlerFresh: true`?

The envelope was broadcast at 11:28:33.7 but no `device-ack` arrived in 4 s. The eventbus shows the Shield client re-subscribing at 11:28:15 and again at 11:28:36 — consistent with a page mid-reload or a half-dead WebView holding stale subscriptions (cf. `reference_piano_tablet_fkb_dead_page` for the FKB zombie-page pattern). Not root-caused here; the URL fallback exists precisely for this case and must work regardless.

---

## Remediation proposal

Fix both layers plus the observability gap. Each item is independently shippable; item 1 alone fixes the user-visible failure.

### 1. Teach the frontend URL parser the queue-op form (primary fix)

`frontend/src/lib/parseAutoplayParams.js`:

```js
export const AUTOPLAY_ACTIONS = Object.freeze([
  'play', 'queue', 'playlist', 'random',
  'display', 'read', 'open',
  'app', 'launch', 'list',
  'play-next', 'play-now',            // queue-op delivery from wake-and-load
]);

const ACTION_MAPPINGS = {
  // ...
  'play-next': (value, config) => ({ queueOp: { op: 'play-next', contentId: toContentId(value), ...config } }),
  'play-now':  (value, config) => ({ queueOp: { op: 'play-now',  contentId: toContentId(value), ...config } }),
};
```

`ScreenRenderer.jsx` (`ScreenAutoplay` emit block, ~line 107):

```js
} else if (autoplay.queueOp) {
  bus.emit('media:queue-op', autoplay.queueOp);
}
```

`ScreenActionHandler.handleMediaQueueOp` already does the right thing for both states (active player → `player:queue-op` event; idle → mount Player with a queue). No changes needed there.

Also pass the end-behavior params through: add `endBehavior`, `endDeviceId`, `endLocation` to `CONFIG_KEYS` so `...config` carries them into the payload (the Player's virtual side-effect tail — see `WakeAndLoadService.mjs:248-255` — depends on them; today the URL path drops them, so `tv-off` at queue end would also have been lost).

Because `useInitialActionGate` imports `AUTOPLAY_ACTIONS`, the loading-shell gate starts engaging for these URLs for free.

### 2. Neuter the alias fallback's footgun

The first-unknown-key→play fallback (lines 123-128) is order-dependent and converts junk params into content ids. Minimum fix — add an ignore list so envelope/bookkeeping keys can never be chosen:

```js
const PASSTHROUGH_KEYS = new Set([
  'op', 'endBehavior', 'endDeviceId', 'endLocation',
  'scanned_at', 'note', 'dispatchId', 'token',
]);
// in the fallback loop:
if (PASSTHROUGH_KEYS.has(key)) continue;
```

Stronger (recommended): only apply the fallback when exactly **one** candidate key remains, and log a `warn` (`autoplay.alias-fallback`) whenever it fires, so future param drift surfaces in logs instead of playing garbage.

### 3. Stop leaking tag metadata into device URLs (backend)

`NfcResolver.mjs` — introduce a metadata blocklist alongside `RESERVED_KEYS`:

```js
const METADATA_KEYS = new Set(['scanned_at', 'note']);
```

Exclude these in both `expandShorthand` candidates and the params-building loop (lines 104-110). Tag bookkeeping stays in YAML; it has no business in a load query. (Belt-and-suspenders: `buildLoadQuery` in `actionHandlers.mjs` could strip them too, but the resolver is the right layer — it owns the tag-schema knowledge.)

### 4. Close the watchdog/prewarm gap for `play-next`

`WakeAndLoadService.mjs`:
- `#armPlaybackWatchdog`: derive `expectedContentId` via `resolveContentId(contentQuery)` (already imported; `CONTENT_ID_KEYS` includes `play-next`) instead of the hand-rolled key list, and arm whenever it resolves — not only for `contentQuery.queue` (line 630).
- Same for the prewarm gate (line 314): prewarm any resolvable content id, or at minimum add `play-next`.

With this, the present incident would have produced `wake-and-load.playback.timeout {expectedContentId: 'plex:621568'}` within 90 s — an actionable alarm instead of silence.

### 5. Tests

- **Unit — `parseAutoplayParams`:** feed the exact prod query string (`?scanned_at=…&note=…&play-next=plex:621568&op=play-next&endBehavior=tv-off&endDeviceId=…&endLocation=…`) and assert `{ queueOp: { op: 'play-next', contentId: 'plex:621568', endBehavior: 'tv-off', … } }`. Add a case asserting the alias fallback never fires when a queue-op/passthrough key is present.
- **Unit — `NfcResolver`:** a tag whose global has `scanned_at`, `note`, and a `plex` shorthand resolves to `content: 'plex:…'` with `params` **not** containing `scanned_at`/`note`.
- **Unit — `WakeAndLoadService`:** watchdog arms for a `play-next` query (mock eventBus; assert `playback.timeout` fires when no `playback.log` matches).
- **Flow (Playwright):** load `/screen/living-room?play-next=plex:<fixture>&op=play-next` and assert the Player mounts with the fixture queue (not `queue.source.unknown`). Use a test fixture id, not household PII.

### Verification plan (post-deploy)

1. Warm path: scan the tag with the TV already on the screen page → expect `wake-and-load.load.ws-ack` and playback.
2. Cold path (the broken one): power off the TV, scan → expect FKB URL load, then `media:queue-op` on the frontend, `queue.resolve {source: 'plex', localId: '621568'}`, and `wake-and-load.playback.confirmed`.
3. Grep for regression signals: `queue.source.unknown`, `autoplay.alias-fallback`, `wake-and-load.playback.timeout`.

### Out of scope (tracked as open questions)

- **Q1:** why the WS-first device-ack timed out despite 2 fresh subscribers (suspected stale/zombie WebView session; investigate `useCommandAckPublisher` liveness vs. reality, cf. FKB dead-page runbook).
- The 11:29:38 `proxy.timeout` (plex, 60 s) — likely a follow-on of the stuck Player; re-check after the fix.
- Player UX: a queue 404 should surface an error state rather than "Loading…" forever (the 9-hour overlay-summary spam at 1 Hz is its own log-volume problem).

**Edge-case hardening surfaced by the final integration review (non-blocking, no backend path exercises them today):**

- **`play-now` is only half-wired for the URL-fallback path.** The frontend parser now maps `play-now` → `{queueOp}` (symmetric with `handleMediaQueueOp`, which handles both ops for the WS-envelope path), but there is no backend `play-now` action handler and `play-now` is not in `CONTENT_ID_KEYS`. So a hypothetical `?play-now=<id>` FKB URL would parse+emit correctly yet NOT arm the watchdog (`resolveContentId` → null) — the same silent-failure class this branch closed for `play-next`. No backend path produces such a URL today. If `play-now` URL delivery is ever added, also add `play-now` to `CONTENT_ID_KEYS` (note: that key set is shared with the WS delivery adapters, so weigh the blast radius).
- **Bare-digit `play-next` could false-alarm the watchdog.** `#armPlaybackWatchdog` matches the raw query value; a tag configured with `play-next: 621568` (no `plex:` prefix) yields `expectedContentId = '621568'`, while `playback.log` emits the normalized `plex:621568` → no match → a spurious `wake-and-load.playback.timeout` despite successful playback. Normal NFC tags carry the shorthand-resolved `plex:621568` (NfcResolver's `expandShorthand`), so this only bites a manually bare-numeric-configured tag. Fix if needed by normalizing `expectedContentId` (a `toContentId`-equivalent) on the backend.
