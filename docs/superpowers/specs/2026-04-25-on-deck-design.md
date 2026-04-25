# On-Deck — Single-Slot "Up Next" for the Player

**Date:** 2026-04-25
**Scope (v1):** AudioPlayer only. Video/Readalong/Singalong renderers deferred.
**Driver:** Kid-mode NFC tag scanning — repeated scans must be tolerated without disrupting playback or accumulating queue duplicates.

---

## 1. Problem

A child holds NFC-tagged storybooks and taps the reader repeatedly to get a reaction. Today an NFC scan fires `action: play`, which steamrolls the currently playing item every time. We need:

- **Re-scan of the currently playing card** → ignored (no disruption).
- **Scan of a different card while something is playing** → puts that item on deck (single slot, newest-wins). Current item plays through; on-deck plays next.
- **Tight preempt window** for the case where a tag fired *just before* the kid taps a different one — overrides immediately if current item has been playing < 15 s.
- **Visual feedback** so the kid sees the system "noticed" each scan.
- **Existing queue functionality undisturbed** — on-deck is an injection between current item and queue, not a queue rebuild.

## 2. Conceptual Model

The Player has three independent playback containers:

| Slot | Capacity | Driver | Replacement rule |
|---|---|---|---|
| **Currently playing** | 1 | the renderer currently mounted | replaced only by `play-now` (or by `play-next` within the 15 s preempt window) |
| **On-deck** | 1 | the staged-next slot | replaced wholesale by every `play-next` (newest-wins) |
| **Queue** | many | the existing `useQueueController` queue array | append via `add` ops; otherwise untouched |

Functionally the playback order is `[current, on-deck-if-any, ...queue]`. Visually the on-deck slot is rendered as a floating card on the AudioPlayer, distinct from the queue, because its **interaction model** is different (single-slot, kid-tappable, ephemeral).

When the current item ends:

1. If on-deck is non-empty → consume it (becomes current). Queue position is preserved (resumes at item N+1 after on-deck plays through).
2. Else → advance through queue normally.

When the user presses Next: consume on-deck first if present; otherwise queue advance. Mirrors the natural playback order.

## 3. Wire Protocol — Reuse Existing Queue Ops

The shared command contract (`shared/contracts/media/commands.mjs`) already enumerates the right ops; we just wire one more:

| Op | Effect on currently playing | Effect on on-deck | Effect on queue |
|---|---|---|---|
| `play-now` | replaces immediately | untouched | untouched |
| `play-next` | untouched* | replaces single slot | untouched** |
| `add` / `add-up-next` | untouched | untouched | appends to tail |

\* Within the **15 s preempt window** (configurable), `play-next` *does* preempt the currently playing item — see §6.

\*\* When `displace_to_queue` (configurable, default `false`) is enabled, a displaced on-deck item is pushed to the head of the queue rather than discarded.

`play-now` is a real semantic shift from today: it currently dismounts the Player overlay and re-mounts a fresh one, which destroys queue and on-deck state. New behavior: in-place swap of the current renderer; queue and on-deck survive.

## 4. Trigger Config Changes

```yaml
# data/household/config/nfc.yml
livingroom:
  target: livingroom-tv
  action: play-next        # was: play
  tags:
    "04kid1":
      plex: 642120
    "04kid2":
      plex: 642121
```

- `action: play-next` becomes a recognized value alongside `play`, `queue`, `open`, `scene`, `ha-service`. No allowlist exists in `TriggerIntent.mjs`; the addition lives in `actionHandlers`.
- Per-tag override of `action` already supported — a tag can set `action: play` to bypass on-deck and force immediate playback.

## 5. Backend Pipeline

### 5.1 `actionHandlers.mjs`

```javascript
'play-next': async (intent, { wakeAndLoadService }) =>
  wakeAndLoadService.execute(
    intent.target,
    { ...(intent.params || {}), op: 'play-next', 'play-next': intent.content },
    { dispatchId: intent.dispatchId || randomUUID() }
  ),
```

The query uses both:
- `op: 'play-next'` — picked up by the WS-first delivery path inside WakeAndLoadService and by WebSocketContentAdapter (see below) to set the envelope's `params.op`.
- `'play-next': content` — used as a content key for the **cold-wake / FKB URL fallback** path. The Player on cold-mount inspects URL query params; a `play-next=plex:642120` becomes the initial on-deck slot, and since the player is idle, it auto-promotes to currently-playing on mount.

### 5.2 `WakeAndLoadService.mjs`

Two lines (415, 499) currently hardcode `op: 'play-now'` when building the WS-first envelope. Replace with:

```javascript
params: { ...opts, op: opts.op || 'play-now', contentId: resolvedContentId }
```

The `op` flows through from the query; defaults preserve existing behavior. No other changes needed — the wake/verify/volume/prepare/prewarm pipeline is op-agnostic.

### 5.3 `WebSocketContentAdapter.mjs`

Line 80 hardcodes `op: 'play-now'`. Same parameterization:

```javascript
params: { ...options, op: options.op || 'play-now', contentId }
```

### 5.4 ContentIdResolver — `play-next` as a recognized key

In `apps/devices/contentIdKeys.mjs` (used by `resolveContentId`), include `play-next` in the priority list of keys that can carry a content id. This lets both the WS-first path and the URL fallback path extract the contentId from `query['play-next']`.

## 6. Player State (Frontend)

### 6.1 New on-deck state inside `useQueueController`

Extend the existing controller (NOT a separate hook — the on-deck slot is conceptually part of the queue's behavior). New state:

```javascript
const [onDeck, setOnDeck] = useState(null);  // PlayableItem or null
const [onDeckFlashKey, setOnDeckFlashKey] = useState(0);  // bumped on dedup-flash
```

Public API additions:

| Method | Purpose |
|---|---|
| `pushOnDeck(item)` | replace single slot; if `displace_to_queue` is true and slot was non-empty, prepend displaced to queue head |
| `flashOnDeck()` | bump `onDeckFlashKey` to trigger CSS re-animation on the card |
| `consumeOnDeck()` | if non-empty: take item, splice into the head of `playQueue`, clear slot; called by `advance()` when on-deck has priority |
| `clearOnDeck()` | drop slot |

`advance()` is modified: if on-deck non-empty, consume it before applying the existing queue-advance logic. If preempt-eligible (`play-next` arrives during < 15 s into current item), call `consumeOnDeck()` *immediately* without waiting for natural end.

### 6.2 Cross-component event channel

`ScreenActionHandler` cannot directly call into the running Player (no shared ref). We introduce a single custom DOM event:

```javascript
window.dispatchEvent(new CustomEvent('player:queue-op', {
  detail: { op, contentId, ...payload }
}));
```

`Player.jsx` (or AudioPlayer specifically, since v1 only handles audio) subscribes via `addEventListener` on mount and `removeEventListener` on unmount. The listener:

1. Looks up the contentId via `/api/v1/play/:source/*` to get a PlayableItem (mediaUrl, title, thumbnail).
2. Compares to currently-playing — if same, calls `flashOnDeck()` and returns.
3. Compares to current on-deck — if same content, also `flashOnDeck()` and returns.
4. Else calls `pushOnDeck(item)`.
5. Checks preempt window: if `currentTime < preemptSeconds`, immediately call `advance()` to consume.

### 6.3 `ScreenActionHandler.handleMediaQueueOp` — new branch

```javascript
if (op === 'play-next') {
  // Detect an active player — same signal the playback handler already uses.
  const playerActive = !!document.querySelector('.audio-player, .video-player audio, .video-player video, dash-video');
  if (!playerActive) {
    // Fall back to play-now semantics: nothing to be "next" to.
    if (isMediaDuplicate(payload.contentId)) return;
    dismissOverlay();
    showOverlay(Player, { play: { contentId: payload.contentId, ...payload }, clear: () => dismissOverlay() });
    return;
  }
  // Player is active — dispatch event; the Player listener inside the overlay handles dedup + push.
  window.dispatchEvent(new CustomEvent('player:queue-op', { detail: { op, ...payload } }));
  return;
}
```

The existing 3 s `MEDIA_DEDUP_WINDOW_MS` check is bypassed for `play-next` — dedup happens semantically (against currently-playing / on-deck contentId) inside the Player, not by time window.

## 7. UI — On-Deck Card

A new component `frontend/src/modules/Player/components/OnDeckCard.jsx`. Rendered by `Player.jsx` (or `SinglePlayer.jsx`) as a **sibling** to the AudioPlayer renderer, not a child. `OnDeckCard` positions itself absolutely (`bottom: 1em; right: 1em;`) relative to the Player root. **AudioPlayer.jsx is untouched.** The on-deck state and APIs live on `useQueueController`; Player passes the current on-deck item and flash key down to `OnDeckCard` as props.

Spec:

- **Square**: width = thumbnail width (~6 em on default chrome). Thumbnail aspect 1:1 occupies most of the card.
- **Title strip** along the bottom: 1 line, truncate with ellipsis (`text-overflow: ellipsis`). *Marquee-on-overflow deferred to v2* — requires JS measurement (ResizeObserver), not needed for kid use case (most story titles fit).
- **Top-left icon**: `▶▶` (or equivalent — small dark chip overlaid on the thumbnail). No text label.
- **Chrome**: 1 px border `rgba(255,255,255,0.18)`, dark translucent backdrop, subtle box shadow.
- **Position**: absolutely positioned bottom-right with 1 em offset.
- **Flash on dedup**: keyframe pulse triggered by `onDeckFlashKey` change (CSS `animation-name` rebound).
- **Update animation**: brief crossfade when slot content changes (~200 ms). Does *not* disrupt audio playback.

Props:
```typescript
{
  item: PlayableItem | null;  // null hides the card
  flashKey: number;           // change triggers acknowledgement flash
}
```

## 8. Configuration

New config block in `data/household/config/player.yml` (create if absent):

```yaml
on_deck:
  preempt_seconds: 15        # play-next within this many seconds preempts current
  displace_to_queue: false   # if true, replaced on-deck items move to queue head
```

Loaded via the existing config loader; surfaced to the Player overlay through screen config (or a single API endpoint, e.g. `/api/v1/config/player`). A small Zod-style guard (or simple validation): `preempt_seconds ∈ [0, 600]`, `displace_to_queue: boolean`.

## 9. State Machine — Edge Cases (Confirmed)

| Case | Behavior |
|---|---|
| Idle player, scan arrives | Play immediately (mount fresh Player; auto-promote on-deck → current). |
| Single-item playing, no queue, scan arrives | Goes on-deck (or preempts within 15 s). After current ends, play on-deck, then idle. |
| Multi-item queue, on item N, scan arrives | Goes on-deck (or preempts). After current ends, play on-deck, then resume queue at item N+1. |
| Same content scanned while it's currently playing | Ignored (no on-deck change). |
| Same content scanned while it's already on-deck | Slot unchanged; flash fires for kid feedback. |
| Different content scanned while something is on-deck | Replace slot (or, if `displace_to_queue`, push displaced to queue head). |
| User presses Next with on-deck non-empty | Consume on-deck → current. Queue continues from where it was. |

## 10. File Changes Summary

| File | Change |
|---|---|
| `backend/src/3_applications/trigger/actionHandlers.mjs` | Add `'play-next'` handler |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Parameterize 2 hardcoded `op: 'play-now'` lines |
| `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs` | Parameterize 1 hardcoded `op: 'play-now'` line |
| `backend/src/3_applications/devices/contentIdKeys.mjs` (or wherever `CONTENT_ID_KEYS` lives) | Add `'play-next'` to recognized id keys |
| `data/household/config/player.yml` | New config block |
| `data/household/config/nfc.yml` | Update `action: play-next` for living-room kid tags |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Handle `op: 'play-next'` branch |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Add on-deck state + APIs; modify `advance()` |
| `frontend/src/modules/Player/components/OnDeckCard.jsx` | New component |
| `frontend/src/modules/Player/components/OnDeckCard.scss` | Styles |
| `frontend/src/modules/Player/Player.jsx` (or wrapper) | Mount `OnDeckCard`; subscribe to `player:queue-op` event; pass on-deck state through |
| Tests | Unit: queueController on-deck APIs, action handler, envelope parameterization. Live: NFC dedup, preempt window, displace_to_queue. |

## 11. Out of Scope (v1)

- VideoPlayer / DASH renderers — defer until kid use case demands it.
- ReadalongScroller / SingalongScroller — different chrome (full-screen scrolling text); revisit if there's a clear UX once v1 ships.
- Multi-slot on-deck (a stack of "next 3 up") — explicitly rejected to keep the kid-tap UX simple.
- Predictive/AI-driven on-deck (e.g., "you usually pick this next"). YAGNI.
- Voice-modality NFC parity — the trigger is modality-agnostic; voice will work the day a `voice` modality lands without code changes.
- Marquee-on-overflow title animation — pure CSS ellipsis is sufficient for v1; marquee requires JS measurement and adds complexity for marginal benefit.
