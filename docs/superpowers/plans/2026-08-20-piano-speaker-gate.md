# Piano Speaker Gate — Implementation Plan

> Historical planning record preserved during the 2026-10-08 integration. Current reference docs and implementation supersede older UI and timing details here. Keypad telemetry uses the existing self-service logger and never records code digits; current stray-input, submit-settle, and screen-off guards remain authoritative.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable video playback in the piano kiosk entirely when the Bluetooth speaker is not connected — no silent video leaking through the tablet speakers.

**Architecture:** The bridge APK already knows A2DP state via `AudioRouteGuard`. We add `speakerOk` to the 1-second WS heartbeat (`broadcastStatus`). The frontend hook `usePianoBridgeNotes` parses it into a `speakerConnected` boolean with hysteresis. That state surfaces through `PianoMidiContext` and gates the three video-playing flows (Courses, Karaoke, Singalong/Playalong).

**Tech Stack:** Java (Android APK), React hooks, vitest

## Global Constraints

- No changes to `frontend/src/lib/Player/` — this gate lives entirely in the piano kiosk layer.
- Non-kiosk clients (no bridge) default to `speakerConnected: true` — the gate is kiosk-only.
- Hysteresis: 3 consecutive `speakerOk:false` heartbeats (3s at 1Hz) before flipping to disconnected; instant recovery on `speakerOk:true`.
- Video exit is immediate (navigate back, unmount), not a pause.

---

### Task 1: Add `speakerOk` to the bridge WS heartbeat

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/ControlServer.java:443-457`

**Interfaces:**
- Consumes: `AudioRouteGuard.routeOk()` and `AudioRouteGuard.reason()` (already exist on `service.getAudioGuard()`)
- Produces: WS heartbeat frame gains `speakerOk: boolean` and `speakerReason: string` fields alongside existing `type:"status"` frames

This task has no automated test — the bridge APK is Android/Java with no local test harness. Verification is via `pbctl status` or observing the WS frame in browser devtools.

- [ ] **Step 1: Add speaker fields to `broadcastStatus()`**

In `ControlServer.java`, modify `broadcastStatus()` to include the audio guard state:

```java
private void broadcastStatus() {
    if (clients.isEmpty()) return;
    try {
        PianoEngine engine = service.getEngine();
        JSONObject o = new JSONObject();
        o.put("type", "status");
        o.put("engine", service.isEngineRunning() ? "running" : "stopped");
        o.put("preset", currentPresetId == null ? JSONObject.NULL : currentPresetId);
        o.put("cpu", engine != null ? engine.cpuLoad() : -1);
        o.put("xruns", engine != null ? engine.xruns() : -1);
        AudioRouteGuard guard = service.getAudioGuard();
        o.put("speakerOk", guard != null && guard.routeOk());
        o.put("speakerReason", guard != null ? guard.reason() : "no_guard");
        broadcast(o.toString());
    } catch (JSONException e) {
        Log.w(TAG, "status build failed", e);
    }
}
```

- [ ] **Step 2: Verify `service.getAudioGuard()` exists**

`SystemDiagnostics.java:104` already calls `service.getAudioGuard()`, so the accessor exists on `PianoBridgeService`. No new method needed.

- [ ] **Step 3: Build and deploy the APK**

Build the APK, install on the tablet, and verify the WS heartbeat now includes `speakerOk` and `speakerReason` by checking `pbctl status` or the browser console network tab for the `ws://localhost:8770` connection.

- [ ] **Step 4: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/ControlServer.java
git commit -m "feat(piano-bridge): add speakerOk to WS heartbeat"
```

---

### Task 2: Parse `speakerOk` in `usePianoBridgeNotes` with hysteresis

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.test.js`

**Interfaces:**
- Consumes: WS `type:"status"` frames with `speakerOk: boolean` (from Task 1)
- Produces: `usePianoBridgeNotes()` return gains `speakerConnected: boolean` (default `true`; `false` after 3 consecutive `speakerOk:false` heartbeats; instant `true` on any `speakerOk:true`)

- [ ] **Step 1: Write failing tests**

Add these tests to `usePianoBridgeNotes.test.js`:

```js
it('defaults speakerConnected to true', async () => {
  const { result } = renderHook(() => usePianoBridgeNotes());
  expect(result.current.speakerConnected).toBe(true);
});

it('stays true after fewer than 3 consecutive speakerOk:false heartbeats', async () => {
  const { result } = renderHook(() => usePianoBridgeNotes());
  const ws = instances[0];
  await act(async () => { ws.onopen?.(); });
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
  });
  expect(result.current.speakerConnected).toBe(true);
});

it('flips to false after 3 consecutive speakerOk:false heartbeats', async () => {
  const { result } = renderHook(() => usePianoBridgeNotes());
  const ws = instances[0];
  await act(async () => { ws.onopen?.(); });
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
  });
  expect(result.current.speakerConnected).toBe(false);
});

it('recovers to true instantly on a single speakerOk:true after being false', async () => {
  const { result } = renderHook(() => usePianoBridgeNotes());
  const ws = instances[0];
  await act(async () => { ws.onopen?.(); });
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
  });
  expect(result.current.speakerConnected).toBe(false);
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: true }) });
  });
  expect(result.current.speakerConnected).toBe(true);
});

it('resets the consecutive counter when a speakerOk:true interrupts', async () => {
  const { result } = renderHook(() => usePianoBridgeNotes());
  const ws = instances[0];
  await act(async () => { ws.onopen?.(); });
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    // Interrupted — counter resets
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: true }) });
    // Start over
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', speakerOk: false }) });
  });
  expect(result.current.speakerConnected).toBe(true); // only 2 consecutive, not 3
});

it('stays true when the bridge is unavailable (non-kiosk client)', async () => {
  vi.useFakeTimers();
  try {
    const { result } = renderHook(() => usePianoBridgeNotes());
    await act(async () => { instances[0].onclose?.({ code: 1006 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { instances[1].onclose?.({ code: 1006 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(result.current.unavailable).toBe(true);
    expect(result.current.speakerConnected).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.test.js`
Expected: FAIL — `speakerConnected` is undefined on the return value.

- [ ] **Step 3: Implement `speakerConnected` with hysteresis**

In `usePianoBridgeNotes.js`:

1. Add state and a ref for the consecutive-false counter:

```js
const SPEAKER_HYSTERESIS = 3;

// inside usePianoBridgeNotes:
const [speakerConnected, setSpeakerConnected] = useState(true);
const speakerFalseRunRef = useRef(0);
```

2. In the `ws.onmessage` handler, after the note.on/note.off block, add status frame handling:

```js
ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === 'note.on') {
      onNoteRef.current?.('note_on', msg.note, msg.velocity ?? 0);
    } else if (msg.type === 'note.off') {
      onNoteRef.current?.('note_off', msg.note, 0);
    } else if (msg.type === 'status' && 'speakerOk' in msg) {
      if (msg.speakerOk) {
        speakerFalseRunRef.current = 0;
        setSpeakerConnected(true);
      } else {
        speakerFalseRunRef.current += 1;
        if (speakerFalseRunRef.current >= SPEAKER_HYSTERESIS) setSpeakerConnected(false);
      }
    }
  } catch {
    // malformed frame — ignore
  }
};
```

3. Include `speakerConnected` in the return value:

```js
return useMemo(() => ({ link, unavailable, speakerConnected }), [link, unavailable, speakerConnected]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.test.js`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.js \
        frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.test.js
git commit -m "feat(piano): parse speakerOk from bridge heartbeat with hysteresis"
```

---

### Task 3: Surface `speakerConnected` through `PianoMidiContext`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.test.jsx`

**Interfaces:**
- Consumes: `bridge.speakerConnected` from `usePianoBridgeNotes()` (Task 2)
- Produces: `usePianoMidi().speakerConnected: boolean` — available to every piano mode

- [ ] **Step 1: Check existing test patterns**

Read `PianoMidiContext.test.jsx` to understand how it mocks the bridge and midi hooks, then follow the same pattern.

- [ ] **Step 2: Write failing test**

Add a test that verifies `speakerConnected` is forwarded from the bridge return value through the context. The exact mock shape depends on what `PianoMidiContext.test.jsx` already does — follow its pattern for mocking `usePianoBridgeNotes`.

```js
it('exposes speakerConnected from the bridge', () => {
  // Mock usePianoBridgeNotes to return speakerConnected: false
  // Render PianoMidiProvider, read usePianoMidi()
  // Assert speakerConnected is false
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.test.jsx`
Expected: FAIL — `speakerConnected` not in context value.

- [ ] **Step 4: Add `speakerConnected` to the context value**

In `PianoMidiContext.jsx`, thread `bridge.speakerConnected` into the provider value:

```jsx
const value = useMemo(() => ({
  ...midi,
  bridgeLink: bridge.link,
  bridgeUnavailable: bridge.unavailable,
  speakerConnected: bridge.speakerConnected,
  connected,
  status,
  midiHealth,
}), [midi, bridge.link, bridge.unavailable, bridge.speakerConnected, connected, status, midiHealth]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.test.jsx`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.jsx \
        frontend/src/modules/Piano/PianoKiosk/PianoMidiContext.test.jsx
git commit -m "feat(piano): expose speakerConnected through PianoMidiContext"
```

---

### Task 4: Gate the Courses video player on speaker state

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.policy.test.jsx` (or a new `Videos.speaker.test.jsx` if the existing file is too large)

**Interfaces:**
- Consumes: `usePianoMidi().speakerConnected` (Task 3)
- Produces: `LecturePlayerRoute` navigates back when speaker disconnects; `CourseDetailRoute` and `CourseGridRoute` propagate the disabled state to child components

The two behaviors:
1. **`LecturePlayerRoute`** — if `speakerConnected` flips to `false` while a video is mounted, call `goBack()` immediately (navigates to `..`, unmounts the Player). Log `piano.video.speaker-gate-exit`.
2. **`CourseDetailRoute`** — pass `speakerDisabled` to `CourseDetail` so it can disable play buttons and show an indicator. The detail/grid components receive it as a prop and grey out.

- [ ] **Step 1: Write failing test for speaker-gate exit**

In a test file for `Videos`, add:

```js
it('navigates back from LecturePlayerRoute when speakerConnected becomes false', () => {
  // Mock usePianoMidi to return speakerConnected: false
  // Render LecturePlayerRoute at a lecture URL
  // Assert navigate('..', { relative: 'path' }) was called
});
```

The exact mock setup depends on how `Videos.policy.test.jsx` is structured — follow its patterns for mocking the MIDI context.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.policy.test.jsx`
Expected: FAIL — no speaker gate in the component.

- [ ] **Step 3: Implement the speaker gate in `LecturePlayerRoute`**

In `Videos.jsx`, inside `LecturePlayerRoute`:

```jsx
import { usePianoMidi } from '../../PianoMidiContext.jsx';

// Inside LecturePlayerRoute, after goBack is defined:
const { speakerConnected } = usePianoMidi();
useEffect(() => {
  if (!speakerConnected) {
    getLogger().child({ component: 'piano-videos' }).info('piano.video.speaker-gate-exit', { courseId, lectureId });
    goBack();
  }
}, [speakerConnected, goBack, courseId, lectureId]);
```

- [ ] **Step 4: Implement disabled state in `CourseDetailRoute`**

Pass `speakerConnected` down so `CourseDetail` can disable play actions:

```jsx
// In CourseDetailRoute, add:
const { speakerConnected } = usePianoMidi();

// Pass to CourseDetail:
<CourseDetail course={course} playable={playable} onPlay={onPlay} speakerDisabled={!speakerConnected} />
```

In `CourseDetail.jsx`, accept `speakerDisabled` and disable the play callback when true. The exact location of the play button depends on the component's structure — find the `onClick` that calls `onPlay` and guard it:

```jsx
// In the lecture list item's onClick:
onClick={speakerDisabled ? undefined : () => onPlay(item)}
```

Add a visual indicator near the play controls when `speakerDisabled` is true — a short text like "Speaker not connected" (no elaborate UI, just an explanation).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/Videos.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/Videos/
git commit -m "feat(piano): gate video playback on speaker connection"
```

---

### Task 5: Gate Karaoke and Singalong/Playalong on speaker state

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Karaoke/Karaoke.jsx`

**Interfaces:**
- Consumes: `usePianoMidi().speakerConnected` (Task 3)
- Produces: `KaraokePlayerRoute` navigates back when speaker disconnects; `KaraokeBrowser` disables song selection

The Karaoke component is reused by both Singalong and Playalong (they pass different `showId`/`startFresh` props), so gating it here covers all three modes.

- [ ] **Step 1: Implement the speaker gate in `KaraokePlayerRoute`**

Same pattern as Task 4's `LecturePlayerRoute`:

```jsx
import { usePianoMidi } from '../../PianoMidiContext.jsx';

// Inside KaraokePlayerRoute, after goBack is defined:
const { speakerConnected } = usePianoMidi();
useEffect(() => {
  if (!speakerConnected) {
    getLogger().child({ component: 'piano-karaoke' }).info('piano.karaoke.speaker-gate-exit', { songId });
    goBack();
  }
}, [speakerConnected, goBack, songId]);
```

- [ ] **Step 2: Disable song selection in `KaraokeBrowser`**

Pass `speakerConnected` to `KaraokeBrowser` and disable the `onSelect` callback:

```jsx
// In Karaoke component, add:
const { speakerConnected } = usePianoMidi();

// Pass to the browse route:
<Route index element={<KaraokeBrowseRoute playable={playable} speakerDisabled={!speakerConnected} />} />
```

In `KaraokeBrowseRoute`, pass `speakerDisabled` to `KaraokeBrowser`. In `KaraokeBrowser`, when `speakerDisabled` is true:
- Song card `onClick` is `undefined` (non-clickable)
- Add a `piano-karaoke--speaker-disabled` class to the section for styling (opacity reduction on the grid)

- [ ] **Step 3: Run existing Karaoke tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Karaoke/`
Expected: All PASS (existing tests should not break; they don't mock `usePianoMidi` with `speakerConnected`, so it defaults to the `true` value from the context default or mock).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Karaoke/Karaoke.jsx
git commit -m "feat(piano): gate karaoke/singalong/playalong on speaker connection"
```

---

### Task 6: Verify end-to-end and add styling

**Files:**
- Modify: CSS files for `CourseDetail` and `KaraokeBrowser` (find the `.scss`/`.css` file that styles `.piano-karaoke` and the course detail lecture list)

**Interfaces:**
- Consumes: `speakerDisabled` prop from Tasks 4 and 5

This task is manual verification + visual polish.

- [ ] **Step 1: Deploy the bridge APK (Task 1) to the tablet**

Build and install. Verify `speakerOk` appears in the WS heartbeat.

- [ ] **Step 2: Run the frontend dev server and verify the gate**

1. With BT speaker connected: open Courses, play a video — should work normally.
2. Disconnect the BT speaker (or use `pbctl speaker disconnect`). Wait 3s. The video should exit and return to the course list. The course list should show disabled play buttons.
3. Reconnect the BT speaker. Play buttons should re-enable instantly.
4. Repeat for Karaoke/Singalong/Playalong.

- [ ] **Step 3: Add disabled styling**

For the course detail lecture list, when `speakerDisabled`:
- Reduce opacity on lecture items (e.g. `opacity: 0.4`)
- Show a small banner or inline text: "Speaker not connected"

For the karaoke grid, when `speakerDisabled`:
- Same opacity treatment on song cards
- No separate banner needed — the cards being visually disabled is sufficient

- [ ] **Step 4: Run all piano kiosk tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(piano): speaker gate styling and visual indicators"
```
