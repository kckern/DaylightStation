# Screen Framework Master Volume

Software-level master volume that uniformly scales every audio surface rendered inside a `ScreenRenderer`. Replaces the previous hardware-level control (numpad → backend → SSH `amixer`); the volume action handler is now purely client-side.

## Model

```
effective = master × component × duck
```

- **master** — per-screen multiplier in `[0, 1]`, owned by `ScreenVolumeProvider`.
- **component** — whatever per-track / per-source volume a renderer already maintains (e.g. a Player audio element's own `volume`).
- **duck** — transient attenuation a component may apply (e.g. fade for narration over background music).

Master only scales the output; components keep full control of their own levels.

## Files

| File | Role |
|------|------|
| `frontend/src/lib/volume/ScreenVolumeContext.js` | Context, hooks, and module-level state for non-React consumers |
| `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx` | Stateful provider — persistence, step / mute logic |
| `frontend/src/screen-framework/overlays/MasterVolumeToast.jsx` | Transient HUD shown on every master change (~1.2s) |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | Maps `display:volume` actions to provider methods |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Mounts `ScreenVolumeProvider` + `MasterVolumeToast` |

## Provider

`ScreenRenderer` wraps each screen in `<ScreenVolumeProvider>` and forwards the optional `volume:` block from the screen YAML config:

```jsx
<ScreenVolumeProvider
  storageKey={`screen-volume-${screenId}`}
  defaultMaster={config.volume?.defaultMaster}
  stepSize={config.volume?.stepSize}
  fixed={config.volume?.fixed}
>
  ...
</ScreenVolumeProvider>
```

Props (all optional):

| Prop | Default | Behavior |
|------|---------|----------|
| `defaultMaster` | `0.5` | Initial master used when no value is stored in localStorage (and the only value in `fixed` mode) |
| `stepSize` | `0.1` | Delta per vol-up / vol-down action |
| `fixed` | `false` | If `true`: lock master at `defaultMaster`, skip localStorage, and make `setMaster` / `step` / `toggleMute` no-ops |

In the default (non-fixed) mode:

- **Persistence:** `localStorage` keyed per screen (`screen-volume-{screenId}`) — no cross-screen sync
- **Mute:** master `=== 0` is the muted state; `toggleMute` flips between `0` and the most recent non-zero master (`preMute`)
- **Step while muted:** applies delta on top of `preMute` so the keys always do what they say (first vol-up press unmutes *and* moves the level)

## YAML Configuration

Optional `volume:` block in `data/household/screens/{screen}.yml`:

```yaml
# Office — software master is the volume knob (numpad steps it, persisted)
volume:
  defaultMaster: 0.5      # initial value on a fresh screen (overridden by localStorage)
  stepSize: 0.1           # how much each vol-up / vol-down moves the master

# Living room — TV remote drives hardware volume via HDMI-CEC, so the
# software master is locked at 100% and nothing scales the audio in software
volume:
  fixed: true
  defaultMaster: 1.0
```

**When to use `fixed: true`:**
- The screen's input adapter doesn't emit `display:volume` (e.g. TV remote routes volume keys to the AVR/TV via HDMI-CEC), and
- All loudness shaping happens on the hardware side.

In fixed mode, localStorage is ignored on init AND not written on changes — the master is config-driven, not user-driven, so there's nothing to remember across sessions. The HUD toast never appears (master never changes after init).

## Consumer APIs

### React: `useScreenVolume()`

```js
import { useScreenVolume } from '../lib/volume/ScreenVolumeContext.js';

const { master, muted, setMaster, step, toggleMute, stepSize } = useScreenVolume();
```

### React: `useEffectiveVolume(local = 1)`

Convenience hook — returns `master × local`. Use it inside a renderer that has its own per-track volume:

```js
import { useEffectiveVolume } from '../lib/volume/ScreenVolumeContext.js';

const effective = useEffectiveVolume(trackVolume);
audioRef.current.volume = effective;
```

### Non-React: `getMasterVolume()` / `subscribeMaster(fn)`

For sound effects, services, and other module-level callers that can't use hooks:

```js
import { getMasterVolume, subscribeMaster } from '../lib/volume/ScreenVolumeContext.js';

const gain = getMasterVolume() * baseGain;     // read at trigger time
const unsubscribe = subscribeMaster((m) => { ... }); // optional live updates
```

The provider mirrors its state into module scope on every change, so non-React reads stay current. **Default value is `1`** — if no `ScreenVolumeProvider` is mounted, every consumer is a no-op, so shared modules (Player, audio bridge, Piano) remain safe to render outside the screen framework.

## Action Mapping

`ScreenActionHandler` translates `display:volume` actions emitted by input adapters (typically `NumpadAdapter`) into provider calls:

| `payload.command` | Effect |
|-------------------|--------|
| `+1` | `step(+stepSize)` |
| `-1` | `step(-stepSize)` |
| `mute_toggle` | `toggleMute()` |

No backend call is made. (The legacy `/api/v1/system/volume` endpoint is left in place for other consumers; removal is a separate task.)

## Current Integrations

- **Player** — `AudioLayer` and `useCommonMediaController` apply master to `HTMLMediaElement.volume`
- **Audio bridge** — `useNativeAudioBridge` multiplies the Web Audio gain node
- **Piano** — wrong-note buzzer (`useSpaceInvadersGame`) reads master at trigger time

## HUD Toast

`MasterVolumeToast` is mounted once by `ScreenRenderer` inside the provider. It renders a transient overlay (`█████░░░░░ 50`) on every master change and auto-hides after ~1.2s. Subsequent changes reset the timer. The initial mount is skipped so the toast doesn't flash on page load.

## Out of Scope

Fitness, Feed, and Weekly Review have their own provider trees and volume systems — they are not affected by the screen-framework master.

## See Also

- Implementation commit: `cc9437ca2` — `feat(screen-framework): software master volume`
- Design notes: `docs/_archive/` once the WIP docs roll off (currently `docs/_wip/plans/2026-05-05-screen-framework-software-volume-design.md`, `docs/_wip/audits/2026-05-05-screen-framework-software-volume-audit.md`)
