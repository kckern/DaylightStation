# HomeLine Video Call — UX Audit

**Date:** 2026-02-22
**Scope:** `CallApp.jsx` (phone) + `VideoCall.jsx` (TV)
**Goal:** Mobile-optimized phone experience, TV-optimized kiosk experience

---

## Phone Side (`CallApp.jsx` + `CallApp.scss`)

### What's Good

- Uses `100vw` / `100vh` with `overflow: hidden` — correct fullscreen intent
- Camera preview is fullscreen in idle/connecting states
- Bottom overlay uses gradient fade — clean look
- Button sizing is touch-friendly (48px circles, pill-shaped hangup)
- Error and loading states are centered overlays

### Issues

#### P0 — Layout Breaking

| # | Issue | Detail |
|---|-------|--------|
| 1 | **iOS 100vh bug** | `100vh` on iOS Safari includes the URL bar. The bottom controls and overlay will be clipped below the visible area. Fix: use `100dvh` (dynamic viewport height) with `100vh` fallback. |
| 2 | **No safe-area inset handling** | On notched/Dynamic Island iPhones, content renders behind the notch and under the home indicator. Bottom overlay needs `padding-bottom: max(2.5rem, env(safe-area-inset-bottom))`. |
| 3 | **Local PIP is not a PIP** | `&__local--pip` has `flex: 1; min-height: 0` — identical to `--full`. In connected mode, the local camera takes up equal vertical space as the remote feed. It should be a small floating overlay (e.g., 120x160 absolute-positioned in a corner). |
| 4 | **No overscroll prevention** | Mobile browsers can pull-to-refresh or rubber-band scroll. Need `overscroll-behavior: none` and `touch-action: manipulation` on the root element to prevent accidental gestures during a call. |

#### P1 — Usability

| # | Issue | Detail |
|---|-------|--------|
| 5 | **Remote video forces 16:9** | `&__video--wide` has `aspect-ratio: 16/9` but the TV sends landscape video — on a portrait phone, this wastes most of the screen. The remote video should fill the available width and let height be natural, or use `object-fit: cover` with constrained container. |
| 6 | **Controls obscure remote video** | In connected mode, the controls bar sits at the bottom with no translucent background — it floats but has no visual separation from the video behind it. Should have a subtle `background: rgba(0,0,0,0.4)` + `backdrop-filter: blur`. |
| 7 | **No landscape support** | If the user rotates to landscape during a call, there's no media query adaptation. Connected mode should stack remote + PIP horizontally in landscape. |
| 8 | **Mute button labels too small** | `font-size: 0.65rem` inside 48px circles makes "Mic Off" / "Cam Off" nearly unreadable. Consider icons instead of text, or increase to at least `0.75rem`. |
| 9 | **Cancel button low contrast** | `color: #aaa` on `border: 1px solid rgba(255,255,255,0.2)` is hard to see and easy to miss. |
| 10 | **No transition between states** | Switching from preview to connected is instant (no fade/slide). A brief cross-fade (200ms) would feel smoother. |

#### P2 — Polish

| # | Issue | Detail |
|---|-------|--------|
| 11 | **Device buttons show raw IDs** | `{device.id}` displays "livingroom-tv" — should show a human-readable label (`device.label` or title-case the ID). |
| 12 | **No haptic feedback** | On mobile, hang-up and mute buttons should trigger `navigator.vibrate(50)` for tactile confirmation. |
| 13 | **Camera error is generic** | "Camera unavailable — check permissions" doesn't distinguish between denied permission and hardware failure. |

### Recommended Connected Layout (Phone, Portrait)

```
┌──────────────────────┐
│ ┌──────┐             │  <- local PIP (120x160, top-right)
│ │ self │   [muted]   │  <- remote mute indicator
│ └──────┘             │
│                      │
│    ┌────────────┐    │
│    │            │    │
│    │  Remote TV │    │  <- remote video, width: 100%, natural height
│    │ (landscape)│    │
│    │            │    │
│    └────────────┘    │
│                      │
│ ┌──────────────────┐ │
│ │ Mic  [Hang Up]  Cam│ │  <- controls bar, safe-area-aware
│ └──────────────────┘ │
└──────────────────────┘
```

---

## TV Side (`VideoCall.jsx` + `VideoCall.scss`)

### What's Good

- Always-mounted video elements with CSS class toggle (no srcObject loss)
- Solo mode: fullscreen local camera with status and volume meter
- ICE error auto-clears after 10s
- Escape key exits

### Issues

#### P0 — Layout Breaking

| # | Issue | Detail |
|---|-------|--------|
| 14 | **Self-view should be small PIP, not 50/50 split** | Current connected layout splits the screen side-by-side: remote portrait on left, local landscape on right. The user's request: self-view should be **small, top-center**. The remote caller should dominate the screen. Current `flex: 1` on local panel gives it equal prominence. |
| 15 | **Remote video forced to 9:16 portrait** | `aspect-ratio: 9/16` on the remote video assumes the phone is always in portrait. If the caller rotates to landscape, the video will be pillarboxed inside a tall narrow container — wasting screen space. Should use `object-fit: contain` without forced aspect ratio, or detect video dimensions via `onResize`/`videoWidth`/`videoHeight` and adapt. |

#### P1 — Usability

| # | Issue | Detail |
|---|-------|--------|
| 16 | **Status overlay stays visible when connected** | "Connected" text stays on screen permanently. After a brief display (2-3s), it should fade out — the visual of two video feeds already communicates the call is active. |
| 17 | **Volume meter visible during call** | The volume meter bar at the bottom is useful in waiting mode (proves mic is working) but clutters the screen during an active call. Should hide when `peerConnected`. |
| 18 | **No visual feedback for remote video mute** | When the phone disables video, the remote panel shows a black rectangle. Should display a "Camera off" placeholder (icon or text on dark background). |
| 19 | **Remote mute badge position** | `top: 1rem; right: 1rem` is absolute to the full container, not relative to the remote panel. If layout changes, the badge won't track the remote video. |

#### P2 — Polish

| # | Issue | Detail |
|---|-------|--------|
| 20 | **No call duration timer** | No way to know how long the call has been going. A subtle timer near the status area would be useful. |
| 21 | **No call-end animation** | When the phone hangs up, the TV snaps back to waiting mode instantly. A brief fade or "Call ended" message (1-2s) before returning to the self-camera view would feel less jarring. |
| 22 | **Waiting status text is static** | "Home Line — Waiting" is informative but could pulse or animate subtly to indicate the system is alive and listening. |

### Recommended Connected Layout (TV, Landscape)

```
┌────────────────────────────────────────────────┐
│              ┌──────────┐                      │
│              │ self PIP │ (small, top-center)   │
│              │ 240x135  │                      │
│              └──────────┘                      │
│                                                │
│         ┌────────────────────────┐             │
│         │                        │             │
│         │     Remote Caller      │             │
│         │   (fills most of       │             │
│         │    screen, adapts to   │             │
│         │    portrait/landscape) │             │
│         │                        │             │
│         └────────────────────────┘             │
│                                                │
│  [Phone audio muted]              [0:03:24]    │
└────────────────────────────────────────────────┘
```

The remote video should:
- Fill the majority of the screen (80-90% of area)
- Center both horizontally and vertically
- Use `object-fit: contain` without forced aspect ratio so portrait and landscape callers both look correct
- The self-view PIP should be ~240x135 (16:9), rounded corners, positioned top-center with slight margin

---

## Cross-Cutting Issues

| # | Issue | Affects | Detail |
|---|-------|---------|--------|
| 23 | **No connection quality indicator** | Both | Neither side shows if the connection is degrading. A simple "Poor connection" warning based on `RTCStatsReport` packet loss would help users understand when video freezes. |
| 24 | **No audio-only fallback** | Both | If video fails, there's no graceful degradation to audio-only. Both sides show a black rectangle with no explanation. |
| 25 | **No reconnection attempt** | Both | ICE `disconnected` → `failed` ends the call. Could attempt ICE restart before giving up. |

---

## Summary of Priorities

**Must fix (P0):** Issues 1-4, 14-15 — layout breaking on real devices
**Should fix (P1):** Issues 5-10, 16-19 — significant UX gaps
**Nice to have (P2):** Issues 11-13, 20-22 — polish items
**Future (cross-cutting):** Issues 23-25 — robustness improvements
