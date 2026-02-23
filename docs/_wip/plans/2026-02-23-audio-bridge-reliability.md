# Audio Bridge Reliability — ADB Pre-emptive + APK Retry + Media Verification

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate ~11s audio delay on Shield TV calls by trying the native audio bridge first, pre-emptively releasing the MIC via ADB, retrying AudioRecord init in the APK, and verifying remote media before showing dual-view.

**Architecture:** Four-layer fix: (1) Frontend already uses bridge-first strategy (done), (2) Backend force-stops FKB via ADB to guarantee clean MIC state, (3) APK retries AudioRecord init with backoff as safety net, (4) Frontend CallApp adds a 4th stepper node that gates dual-view on confirmed remote video+audio tracks.

**Tech Stack:** Java (Android APK), Node.js/ES modules (backend), React JSX (frontend)

---

### Task 1: Commit bridge-first VideoCall.jsx change

The bridge-first strategy in `VideoCall.jsx` was implemented in a prior session and is ready to commit.

**File:** `frontend/src/modules/Input/VideoCall.jsx` (already modified)

**Step 1: Verify the diff looks correct**

```bash
git diff frontend/src/modules/Input/VideoCall.jsx
```

Expected: `useState(null)` → `useState(undefined)`, added `else`/`.catch` branches setting `null`, replaced probe-first block with bridge-first orchestration.

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.jsx
git commit -m "fix: bridge-first audio source selection for Shield TV calls

When an audio bridge is configured, try it immediately instead of
waiting ~11s for the audio probe to exhaust all devices. The probe's
sequential getUserMedia calls (3 devices × 3 methods × 1.5s timeout)
blocked the bridge and competed for the MIC resource.

Now: bridge first, probe only as fallback if bridge reports unavailable."
```

---

### Task 2: Add AudioRecord retry logic to bridge APK

**File:** `_extensions/audio-bridge/app/app/src/main/java/net/kckern/audiobridge/AudioBridgeService.java`

**Step 1: Add retry constants after the existing constants (after line 34)**

Add these constants after the `FRAME_SIZE` line:

```java
// Retry config for AudioRecord initialization
private static final int INIT_MAX_RETRIES = 3;
private static final int[] INIT_RETRY_DELAYS_MS = {500, 1000, 2000};
```

**Step 2: Replace `startCapture()` method (lines 167-230) with retry version**

Replace the entire `startCapture` method with:

```java
private void startCapture(WebSocket client) {
    int minBufSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
    int bufferSize = Math.max(minBufSize, FRAME_SIZE * 4);

    // Retry loop: AudioRecord init may fail if FKB services are still releasing MIC
    for (int attempt = 0; attempt <= INIT_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            int delayMs = INIT_RETRY_DELAYS_MS[Math.min(attempt - 1, INIT_RETRY_DELAYS_MS.length - 1)];
            Log.i(TAG, "AudioRecord init retry " + attempt + "/" + INIT_MAX_RETRIES + " after " + delayMs + "ms");
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException e) {
                Log.w(TAG, "Retry sleep interrupted");
                Thread.currentThread().interrupt();
                break;
            }
            if (!client.isOpen()) {
                Log.i(TAG, "Client disconnected during retry wait");
                activeClient = null;
                return;
            }
        }

        try {
            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE,
                    CHANNEL_CONFIG,
                    AUDIO_FORMAT,
                    bufferSize
            );
        } catch (SecurityException e) {
            Log.e(TAG, "RECORD_AUDIO permission not granted", e);
            client.send("{\"error\":\"RECORD_AUDIO permission not granted\"}");
            client.close(1011, "Permission denied");
            activeClient = null;
            return;
        }

        if (audioRecord.getState() == AudioRecord.STATE_INITIALIZED) {
            Log.i(TAG, "AudioRecord initialized on attempt " + (attempt + 1));
            break; // success
        }

        // Not initialized — clean up and retry
        Log.w(TAG, "AudioRecord init failed on attempt " + (attempt + 1) + "/" + (INIT_MAX_RETRIES + 1));
        audioRecord.release();
        audioRecord = null;

        if (attempt == INIT_MAX_RETRIES) {
            Log.e(TAG, "AudioRecord failed to initialize after all retries");
            client.send("{\"error\":\"AudioRecord failed to initialize\"}");
            client.close(1011, "AudioRecord init failed");
            activeClient = null;
            return;
        }
    }

    capturing = true;
    audioRecord.startRecording();
    Log.i(TAG, "AudioRecord started: source=MIC rate=" + SAMPLE_RATE
            + " bufferSize=" + bufferSize + " minBufSize=" + minBufSize);

    captureThread = new Thread(() -> {
        byte[] buffer = new byte[FRAME_SIZE];
        long frameCount = 0;

        while (capturing && client.isOpen()) {
            int bytesRead = audioRecord.read(buffer, 0, FRAME_SIZE);
            if (bytesRead > 0) {
                try {
                    client.send(ByteBuffer.wrap(buffer, 0, bytesRead));
                } catch (WebsocketNotConnectedException e) {
                    Log.i(TAG, "Client disconnected during send");
                    break;
                }
                frameCount++;
                if (frameCount % 1000 == 0) {
                    Log.d(TAG, "Sent " + frameCount + " frames ("
                            + (frameCount * 10) + "ms)");
                }
            } else if (bytesRead < 0) {
                Log.e(TAG, "AudioRecord.read error: " + bytesRead);
                break;
            }
        }

        Log.i(TAG, "Capture loop ended after " + frameCount + " frames");
    }, "AudioBridge-Capture");
    captureThread.setPriority(Thread.MAX_PRIORITY);
    captureThread.start();
}
```

**Step 3: Build the APK**

```bash
cd _extensions/audio-bridge/app && sh gradlew assembleDebug
```

Expected: `BUILD SUCCESSFUL`, APK at `app/build/outputs/apk/debug/app-debug.apk`.

**Step 4: Commit**

```bash
git add _extensions/audio-bridge/app/app/src/main/java/net/kckern/audiobridge/AudioBridgeService.java
git commit -m "feat: add AudioRecord retry with backoff in bridge APK

AudioRecord init may fail if FKB services haven't released the MIC yet.
Retry up to 3 times with 500ms/1s/2s delays before giving up. Logs
each retry attempt for diagnostics."
```

---

### Task 3: FK adapter — accept optional AdbAdapter for FKB force-restart

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs`
- Test: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs`

**Step 1: Write failing tests for ADB force-restart behavior**

Append to the existing `describe('prepareForContent', ...)` block in the test file:

```javascript
it('should force-stop and re-launch FKB via ADB after disabling settings', async () => {
  const callOrder = [];
  const httpClient = {
    get: vi.fn(async (url) => {
      const cmd = url.match(/[?&]cmd=([^&]+)/)?.[1];
      const key = url.match(/[?&]key=([^&]+)/)?.[1];
      callOrder.push(key ? `${cmd}:${key}` : cmd);
      if (cmd === 'getDeviceInfo') {
        return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully' }) };
      }
      return { status: 200, data: '{}' };
    }),
  };

  const mockAdb = {
    connect: vi.fn(async () => ({ ok: true })),
    shell: vi.fn(async () => ({ ok: true, output: '' })),
    launchActivity: vi.fn(async () => ({ ok: true })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  expect(result.ok).toBe(true);

  // ADB connect called
  expect(mockAdb.connect).toHaveBeenCalledOnce();

  // force-stop called via shell
  expect(mockAdb.shell).toHaveBeenCalledWith('am force-stop de.ozerov.fully');

  // re-launch called
  expect(mockAdb.launchActivity).toHaveBeenCalledWith('de.ozerov.fully/.TvActivity');

  // Order: screenOn → settings → ADB force-stop → ADB launch → toForeground
  const lastSettingIdx = callOrder.indexOf('setBooleanSetting:acousticScreenOn');
  const firstFgIdx = callOrder.indexOf('toForeground');
  expect(lastSettingIdx).toBeLessThan(firstFgIdx);
});

it('should skip ADB restart when no adbAdapter provided', async () => {
  const httpClient = createMockHttpClient();

  const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
  const result = await adapter.prepareForContent();

  expect(result.ok).toBe(true);
  // No ADB calls — just verify it completes normally
});

it('should continue if ADB force-stop fails (non-blocking)', async () => {
  const httpClient = createMockHttpClient();
  const mockAdb = {
    connect: vi.fn(async () => ({ ok: false, error: 'ADB offline' })),
    shell: vi.fn(async () => ({ ok: false })),
    launchActivity: vi.fn(async () => ({ ok: false })),
  };

  const adapter = new FullyKioskContentAdapter(
    { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
    { httpClient, logger: mockLogger, adbAdapter: mockAdb }
  );
  const result = await adapter.prepareForContent();

  // Should still succeed — ADB is non-blocking
  expect(result.ok).toBe(true);
  expect(mockLogger.warn).toHaveBeenCalledWith(
    'fullykiosk.prepareForContent.adbRestart.failed',
    expect.objectContaining({ error: expect.any(String) }),
  );
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: 3 new tests FAIL (constructor doesn't accept `adbAdapter`, no ADB calls in `prepareForContent`).

**Step 3: Modify the FK adapter constructor to accept optional AdbAdapter**

In `FullyKioskContentAdapter.mjs`, add to the constructor (after line 47):

```javascript
this.#adbAdapter = deps.adbAdapter || null;
this.#launchActivity = config.launchActivity || null;
```

Add private fields (after line 23):

```javascript
#adbAdapter;
#launchActivity;
```

**Step 4: Add ADB force-restart after settings disable in `prepareForContent()`**

In `prepareForContent()`, after the `setBooleanSetting` loop (after line 95) and before the `toForeground` loop (line 97), insert:

```javascript
// Force-restart FKB via ADB to guarantee audio services release MIC.
// Settings are already persisted above, so FKB restarts clean.
// Non-blocking: log failures but don't abort prepare.
if (this.#adbAdapter && this.#launchActivity) {
  try {
    const connectResult = await this.#adbAdapter.connect();
    if (connectResult.ok) {
      const stopResult = await this.#adbAdapter.shell('am force-stop de.ozerov.fully');
      this.#logger.info?.('fullykiosk.prepareForContent.adbForceStop', { ok: stopResult.ok });
      // Brief pause for process to fully terminate
      await new Promise(r => setTimeout(r, 500));
      const launchResult = await this.#adbAdapter.launchActivity(this.#launchActivity);
      this.#logger.info?.('fullykiosk.prepareForContent.adbRelaunch', { ok: launchResult.ok });
    } else {
      this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', {
        error: connectResult.error || 'ADB connect failed'
      });
    }
  } catch (err) {
    this.#logger.warn?.('fullykiosk.prepareForContent.adbRestart.failed', { error: err.message });
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: All 6 tests PASS.

**Step 6: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
git commit -m "feat: ADB force-restart FKB in prepareForContent to release MIC

After disabling FKB audio services via REST API (settings persist),
force-stop FKB via ADB and re-launch. On restart FKB reads saved
settings so audio services stay off, guaranteeing AudioRecord can
init. Non-blocking: ADB failures don't abort prepare."
```

---

### Task 4: DeviceFactory — pass AdbAdapter to FK adapter

**File:** `backend/src/3_applications/devices/services/DeviceFactory.mjs`

**Step 1: Modify `#buildContentControl()` to pass ADB to FK adapter**

In the `fully-kiosk` provider block (lines 160-191), create the ADB adapter before the FK adapter and pass it in:

Replace lines 160-191 with:

```javascript
      // Create ADB adapter if fallback is configured (used for both
      // pre-emptive MIC release inside FK adapter and connection-error recovery)
      let adbAdapter = null;
      let launchActivity = null;
      if (config.fallback?.provider === 'adb') {
        adbAdapter = new AdbAdapter(
          { host: config.fallback.host, port: config.fallback.port },
          { logger: this.#logger }
        );
        launchActivity = config.fallback.launch_activity;

        this.#logger.info?.('deviceFactory.resilientContentControl', {
          primary: 'fully-kiosk',
          fallback: 'adb',
          adbSerial: `${config.fallback.host}:${config.fallback.port}`
        });
      }

      const fkbAdapter = new FullyKioskContentAdapter(
        {
          host: config.host,
          port: config.port,
          password: password || '',
          daylightHost: this.#daylightHost,
          launchActivity
        },
        { httpClient: this.#httpClient, logger: this.#logger, adbAdapter }
      );

      // Wrap with ADB recovery if fallback is configured
      if (adbAdapter) {
        return new ResilientContentAdapter(
          {
            primary: fkbAdapter,
            recovery: adbAdapter,
            launchActivity
          },
          { logger: this.#logger }
        );
      }

      return fkbAdapter;
```

**Step 2: Run existing tests to verify no regressions**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add backend/src/3_applications/devices/services/DeviceFactory.mjs
git commit -m "wire: pass AdbAdapter into FK adapter for pre-emptive MIC release

When ADB fallback is configured, the same AdbAdapter instance is now
passed to both FullyKioskContentAdapter (for force-restart during
prepareForContent) and ResilientContentAdapter (for connection-error
recovery)."
```

---

### Task 5: CallApp — 4th stepper node for remote media verification

**File:** `frontend/src/Apps/CallApp.jsx`

**Step 1: Add 4th step to STEP_DEFS (after line 24)**

```jsx
const STEP_DEFS = [
  { key: 'power',   label: 'Powering on TV',      icon: 'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0119 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.15.97-4.08 2.5-5.37L6.17 5.17A8.96 8.96 0 003 12c0 4.97 4.03 9 9 9s9-4.03 9-9a8.96 8.96 0 00-3.17-6.83z' },
  { key: 'prepare', label: 'Preparing kiosk',      icon: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z' },
  { key: 'load',    label: 'Loading video call',    icon: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z' },
  { key: 'media',   label: 'Verifying connection',  icon: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z' },
];
```

(The `media` icon is the Material Design wifi/signal icon.)

**Step 2: Add `remoteVerified` state and verification effect**

After the `remoteVideoRef` declaration (line 101), add:

```jsx
const [remoteVerified, setRemoteVerified] = useState(false);

// Verify remote stream has live video + audio tracks before transitioning to dual view.
// Gates the "connected" state so we don't show an empty remote panel.
useEffect(() => {
  if (!peerConnected || !peer.remoteStream) {
    setRemoteVerified(false);
    return;
  }

  const check = () => {
    const stream = peer.remoteStream;
    const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live');
    const hasAudio = stream.getAudioTracks().some(t => t.readyState === 'live');
    if (hasVideo && hasAudio) {
      logger.info('remote-media-verified', {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length
      });
      setRemoteVerified(true);
    }
    return hasVideo && hasAudio;
  };

  // Check immediately (tracks may already be present)
  if (check()) return;

  // Poll every 200ms until tracks arrive
  const interval = setInterval(() => {
    if (check()) clearInterval(interval);
  }, 200);

  // Timeout: fail after 8s
  const timeout = setTimeout(() => {
    clearInterval(interval);
    if (!remoteVerified) {
      logger.warn('remote-media-timeout', { elapsed: '8s' });
      setRemoteVerified(true); // proceed anyway after timeout — don't block forever
    }
  }, 8000);

  return () => {
    clearInterval(interval);
    clearTimeout(timeout);
  };
}, [peerConnected, peer.remoteStream, logger]);
```

**Step 3: Feed `media` step into the stepper progress overlay**

The `wakeProgress` object comes from the backend SSE. We need to overlay the frontend-only `media` step. Find where `wakeProgress` is used in the connecting overlay (line 649) and create a merged progress:

After the `wakeProgress` destructuring (line 97-99), add a derived progress that includes step 4:

```jsx
// Merge backend wake progress with frontend media verification step
const displayProgress = useMemo(() => {
  if (!wakeProgress) return null;
  const mediaStatus = !peerConnected ? null
    : remoteVerified ? 'done'
    : 'running';
  return { ...wakeProgress, media: mediaStatus };
}, [wakeProgress, peerConnected, remoteVerified]);
```

Then update the stepper render (around line 649-651) to use `displayProgress` instead of `wakeProgress`:

```jsx
{displayProgress ? (
  <WakeStepper progress={displayProgress} />
) : (
```

**Step 4: Gate dual-view on `remoteVerified`**

Change line 472 from:

```jsx
const isConnected = !isIdle && !isConnecting && !wakeError;
```

To:

```jsx
const isConnected = !isIdle && !isConnecting && !wakeError && remoteVerified;
```

**Step 5: Keep stepper visible during media verification**

Currently `isConnecting` is `status === 'connecting' || waking`. Once the WebRTC peer connects, `status` changes to `'connected'` and the stepper disappears before media is verified. Update `isConnecting` (line 471) to include the verification phase:

```jsx
const isConnecting = status === 'connecting' || waking || (peerConnected && !remoteVerified);
```

**Step 6: Reset `remoteVerified` on call end**

In the `endCall` callback (around line 367), add `setRemoteVerified(false)` alongside the other state resets:

```jsx
const endCall = useCallback(() => {
  reset();
  exitZoom();
  resetWakeProgress();
  setRemoteVerified(false);
  // ... rest unchanged
```

**Step 7: Build and verify**

```bash
cd frontend && npx vite build --mode development
```

Expected: Build succeeds with no errors.

**Step 8: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat: add media verification step to call stepper

4th stepper node 'Verifying connection' waits for remote stream to
have live video + audio tracks before transitioning to dual-view.
Prevents showing an empty remote panel and fixes the play() AbortError
race condition from rapid stream changes."
```

---

### Task 6: Deploy and verify

**Step 1:** User runs deploy manually per project rules.

**Step 2:** Sideload updated APK to Shield TV:

```bash
adb connect 10.0.0.11:5555
adb -s 10.0.0.11:5555 install -r _extensions/audio-bridge/app/app/build/outputs/apk/debug/app-debug.apk
adb -s 10.0.0.11:5555 shell am start -n net.kckern.audiobridge/.MainActivity
```

**Step 3:** Initiate a fresh call from phone to Shield TV.

**Step 4:** Check logs for the full flow:

```bash
ssh homeserver.local 'docker logs --since 5m daylight-station 2>&1' | grep -E '(adbForceStop|adbRelaunch|bridge-|AudioRecord|remote-media-verified|media-timeout)'
```

Expected sequence:
1. `adbForceStop` → `ok: true`
2. `adbRelaunch` → `ok: true`
3. `bridge-connecting` within ~200ms of mount
4. `bridge-ws-open` → `bridge-format` → AudioRecord succeeds (no 1011 close)
5. `remote-media-verified` on phone before dual-view shows

**Step 5:** If AudioRecord still fails on first attempt, check for retry logs:

```bash
adb -s 10.0.0.11:5555 logcat -s AudioBridge | grep -E '(retry|init|initialized)'
```

Expected: `AudioRecord init retry 1/3 after 500ms` → `AudioRecord initialized on attempt 2`
