# Piano Tablet Fail-Closed Audio Guard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The piano tablet must never emit audio from its own built-in speaker. If the Bluetooth A2DP sink (the piano) is disconnected or unavailable, all tablet audio — the native synth *and* the Chromium WebView — is silent.

**Architecture:** Four layers. A single fail-closed truth value (`routeOk`) derived from A2DP connection state plus the connected-output-device set. A native render gate that silences `VoiceHost` when the gate is clear. A persistent `STREAM_MUSIC` volume floor pinned to 0 on the built-in-speaker device index, which is the only lever that reaches WebView audio. And an idempotent reconciler that reasserts desired state from observed state on a timer rather than trusting events.

**Tech Stack:** Android API 29 (Samsung SM-T590, `armeabi-v7a`), Java 11, NDK/CMake + Oboe 1.8.1, NanoHTTPD control plane on `:8770`, `pbctl.mjs` CLI over LAN HTTP.

---

## Background: what was verified on hardware

All of this was measured on the live tablet at `10.0.0.245:8770` on 2026-07-09. **Do not re-litigate these; they are settled.** Do not trust `DESIGN.md` where it contradicts them (see Task 10).

1. **Per-device `STREAM_MUSIC` indices are real and independent.** `dumpsys audio` shows `2 (speaker): 15\150, 4 (headset): 8\80, 8 (headphone): 12\120, 80 (bt_a2dp): 15\150`. `Min: 0, Max: 15`. Pinning the speaker index to 0 does not touch the A2DP index.

2. **The settings DB is NOT app-writable for these keys.** `Settings.System.putString("volume_music_speaker","0")` returns `"You cannot keep your settings in the secure settings."` They are readable via `Settings.System.getString` but not writable. `WRITE_SECURE_SETTINGS` does not help — these live in `Settings.System`, not `Settings.Secure`. The shell fallback is also unavailable: `cmd media_session volume` reports `No shell command implementation` on API 29.

3. **Therefore the only lever is `AudioManager.setStreamVolume(STREAM_MUSIC, 0, 0)`**, which writes the index of the **currently active** output device. It cannot pre-pin the speaker while A2DP is connected — calling it then would clamp the *piano's* volume instead.

4. **The clamp is permanent once applied.** `AudioService` persists the per-device index back to the settings DB (that is where the observed `volume_music_speaker=15` comes from). Clamp once on the speaker and never restore, and the index stays 0 across reconnects, process death, and reboots. **The exposure window is one-time**, and Task 8 spends it deliberately.

5. **The volume floor also covers the synth.** Oboe's default `usage=media` maps to `STREAM_MUSIC`, so a zeroed speaker index silences `VoiceHost` output too. The native render gate (Task 5) is defense-in-depth, not the sole mechanism.

6. **`adjustStreamVolume(..., ADJUST_MUTE, ...)` must NOT be used.** `AudioService` tracks it per-client and auto-releases it on process death, so a crashed bridge would *restore* audio. It fails open. This is the opposite of the requirement.

7. **`dumpsys bluetooth_manager` and `dumpsys audio` DO work** from the app via `/exec`, because `DUMP` and `READ_LOGS` are `pm grant`-ed. `DESIGN.md` claims SELinux blocks all `dumpsys`; that claim is wrong and Task 10 fixes it.

8. **API 29 cannot query the active output route.** `getDevices(GET_DEVICES_OUTPUTS)` returns *connected* devices, not the active one. `getDevicesForAttributes` is `@SystemApi` until API 31. **We infer**: media is on the built-in speaker iff no A2DP and no wired output device is connected. This is sound for a tablet sealed in an antitheft box (no headphone access), and it is exactly the inference Task 9 verifies against ground truth from `dumpsys audio`.

**Known unknowns, to be resolved during implementation, not assumed away:**

- `AudioDeviceCallback` firing latency relative to the A2DP disconnect broadcast. Bounds the one-time window only. Measured in Task 9.
- `A2dpConnector`'s reflection-based `connect()` **has never once succeeded** in the device's Bluetooth log (`reconnects: 5153`, every attempt against an unbonded device). Its efficacy against a *bonded-but-disconnected* device is unverified. Task 8 exercises it for the first time.

**Target device identity:** speaker MAC `64:49:A5:8B:9B:75`, name `J2-USB Bluetooth` (the MDG-400's A2DP sink), already present in `DeviceConfig.speakerMac()`.

---

## Setup

Work in an isolated worktree (see @superpowers:using-git-worktrees). Build environment:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
cd _extensions/piano-bridge/app
./gradlew :app:assembleDebug        # NOT system gradle — use the wrapper
```

Control plane for probing (no ADB, no USB):

```bash
export PB=http://10.0.0.245:8770
curl -s $PB/speaker | python3 -m json.tool
```

---

## Task 1: JVM unit-test harness

The APK has no test source set and no JUnit dependency. Every subsequent task is TDD, so this comes first.

**Files:**
- Modify: `_extensions/piano-bridge/app/app/build.gradle`
- Create: `_extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/HarnessSmokeTest.java`

**Step 1: Write the failing test**

```java
package net.kckern.pianobridge;

import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class HarnessSmokeTest {
    @Test public void harnessRuns() { assertTrue(true); }
}
```

**Step 2: Run it and watch it fail**

Run: `./gradlew :app:testDebugUnitTest`
Expected: FAIL — `package org.junit does not exist`.

**Step 3: Add the dependency**

In `app/build.gradle`, inside `dependencies { ... }`:

```groovy
    testImplementation 'junit:junit:4.13.2'
```

**Step 4: Run it and watch it pass**

Run: `./gradlew :app:testDebugUnitTest`
Expected: PASS, 1 test.

**Step 5: Commit**

```bash
git add _extensions/piano-bridge/app/app/build.gradle \
        _extensions/piano-bridge/app/app/src/test
git commit -m "test(piano-bridge): add JVM unit-test source set and JUnit"
```

---

## Task 2: `AudioGuardPolicy` — the pure decision function

Keep all decision logic free of Android types so it is testable on the JVM. The policy takes an observed world and returns an intent; it touches nothing.

**Files:**
- Create: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/AudioGuardPolicy.java`
- Test: `_extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/AudioGuardPolicyTest.java`

**Step 1: Write the failing tests**

Note the fail-closed cases: an unknown/empty world must gate, not pass.

```java
package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

import net.kckern.pianobridge.AudioGuardPolicy.Decision;
import net.kckern.pianobridge.AudioGuardPolicy.World;

public class AudioGuardPolicyTest {

    private static World world(boolean a2dpConnected, boolean a2dpOutputPresent,
                               boolean wiredPresent, int speakerIndex) {
        return new World(a2dpConnected, a2dpOutputPresent, wiredPresent, speakerIndex);
    }

    @Test public void speakerRouted_gatesAndClamps() {
        Decision d = AudioGuardPolicy.decide(world(false, false, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertTrue(d.clampSpeakerVolume);
        assertEquals("no_a2dp_output", d.reason);
    }

    @Test public void speakerAlreadyClamped_noRedundantWrite() {
        Decision d = AudioGuardPolicy.decide(world(false, false, false, 0));
        assertTrue(d.gateSynth);
        assertFalse(d.clampSpeakerVolume); // idempotent: already 0
    }

    @Test public void a2dpConnectedAndPresent_opensGate() {
        Decision d = AudioGuardPolicy.decide(world(true, true, false, 0));
        assertTrue(d.routeOk);
        assertFalse(d.gateSynth);
        assertFalse(d.clampSpeakerVolume);
        assertEquals("ok", d.reason);
    }

    /** Profile says connected but the audio stack has no A2DP output: fail closed. */
    @Test public void a2dpConnectedButNoOutputDevice_failsClosed() {
        Decision d = AudioGuardPolicy.decide(world(true, false, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertTrue(d.clampSpeakerVolume);
        assertEquals("no_a2dp_output", d.reason);
    }

    /** Output device present but the profile is not connected: fail closed. */
    @Test public void a2dpOutputWithoutProfileConnection_failsClosed() {
        Decision d = AudioGuardPolicy.decide(world(false, true, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertEquals("not_connected", d.reason);
    }

    /**
     * Wired output present and no A2DP: the gate still closes (not our sink), but we
     * must NOT clamp, because setStreamVolume would write the WIRED index, not the
     * speaker's. Clamping is only correct when the speaker is the inferred route.
     */
    @Test public void wiredRoute_gatesButDoesNotClamp() {
        Decision d = AudioGuardPolicy.decide(world(false, false, true, 15));
        assertTrue(d.gateSynth);
        assertFalse(d.clampSpeakerVolume);
        assertEquals("wired_route", d.reason);
    }
}
```

**Step 2: Run to verify failure**

Run: `./gradlew :app:testDebugUnitTest --tests '*AudioGuardPolicyTest*'`
Expected: FAIL — `cannot find symbol: class AudioGuardPolicy`.

**Step 3: Implement**

```java
package net.kckern.pianobridge;

/**
 * AudioGuardPolicy — the pure, Android-free decision core of the fail-closed audio
 * guard. Given an observed World, returns what should be true. Performs no I/O and
 * holds no state, so the reconciler that calls it is trivially idempotent.
 *
 * Fail-closed: any world that does not positively demonstrate a live A2DP route
 * gates the synth. See docs/_wip/plans/2026-07-09-piano-tablet-fail-closed-audio-guard.md.
 */
public final class AudioGuardPolicy {

    /** Observed state. `speakerIndex` is the STREAM_MUSIC index for the built-in speaker. */
    public static final class World {
        public final boolean a2dpConnected;      // BluetoothA2dp reports our MAC connected
        public final boolean a2dpOutputPresent;  // an A2DP device is in getDevices(OUTPUTS)
        public final boolean wiredPresent;       // headset/headphone/USB output present
        public final int     speakerIndex;       // current STREAM_MUSIC index for the speaker

        public World(boolean a2dpConnected, boolean a2dpOutputPresent,
                     boolean wiredPresent, int speakerIndex) {
            this.a2dpConnected = a2dpConnected;
            this.a2dpOutputPresent = a2dpOutputPresent;
            this.wiredPresent = wiredPresent;
            this.speakerIndex = speakerIndex;
        }
    }

    public static final class Decision {
        public final boolean routeOk;
        public final boolean gateSynth;           // true = VoiceHost must render silence
        public final boolean clampSpeakerVolume;  // true = setStreamVolume(MUSIC, 0)
        public final String  reason;

        Decision(boolean routeOk, boolean gateSynth, boolean clampSpeakerVolume, String reason) {
            this.routeOk = routeOk;
            this.gateSynth = gateSynth;
            this.clampSpeakerVolume = clampSpeakerVolume;
            this.reason = reason;
        }
    }

    private AudioGuardPolicy() { }

    public static Decision decide(World w) {
        if (w.a2dpConnected && w.a2dpOutputPresent) {
            return new Decision(true, false, false, "ok");
        }
        // Gate closed from here down. Decide whether a clamp is also correct.
        final String reason =
                !w.a2dpOutputPresent ? (w.wiredPresent ? "wired_route" : "no_a2dp_output")
                                     : "not_connected";

        // API 29 cannot query the active route. Infer: the speaker is active iff no
        // A2DP and no wired output is connected. Clamping when a wired device is
        // present would write the WIRED index instead of the speaker's — so don't.
        final boolean speakerIsRoute = !w.a2dpOutputPresent && !w.wiredPresent;
        final boolean clamp = speakerIsRoute && w.speakerIndex > 0; // idempotent
        return new Decision(false, true, clamp, reason);
    }
}
```

Note: `a2dpOutputWithoutProfileConnection_failsClosed` expects `not_connected` — reached because `a2dpOutputPresent` is true, so the ternary's first branch is skipped.

**Step 4: Run to verify pass**

Run: `./gradlew :app:testDebugUnitTest --tests '*AudioGuardPolicyTest*'`
Expected: PASS, 6 tests.

**Step 5: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/AudioGuardPolicy.java \
        _extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/AudioGuardPolicyTest.java
git commit -m "feat(piano-bridge): fail-closed audio guard decision policy"
```

---

## Task 3: Native render gate in `VoiceHost`

`VoiceHost::render()` currently emits engine audio whenever an engine is loaded. Add a gate the audio thread reads lock-free.

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/VoiceHost.h`
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/VoiceHost.cpp:74-81` (`render`)

**Step 1: Declare the gate**

In `VoiceHost.h`, public section:

```cpp
    // Fail-closed output gate. When false, render() emits silence regardless of
    // engine state. Set from the Java guard via PianoEngine.setOutputGate.
    // Defaults to FALSE: audio must be positively enabled, never assumed.
    void setOutputGate(bool open) { gateOpen_.store(open, std::memory_order_release); }
    bool outputGate() const { return gateOpen_.load(std::memory_order_acquire); }
```

Private section:

```cpp
    std::atomic<bool> gateOpen_{false};   // fail-closed default
```

**Step 2: Gate `render()`**

Replace the body of `VoiceHost::render` in `VoiceHost.cpp`:

```cpp
void VoiceHost::render(float* out, int frames) {
    Engine* e = active_.load(std::memory_order_acquire);
    if (e && gateOpen_.load(std::memory_order_acquire)) {
        e->render(out, frames);
    } else {
        std::memset(out, 0, sizeof(float) * frames * 2); // silence
    }
}
```

The gate is checked *inside* the audio callback with a relaxed-cost atomic load, so a gate close takes effect on the next block (≈ one burst, single-digit ms) with no locking.

**Step 3: Verify it compiles**

Run: `./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

**Step 4: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/cpp/VoiceHost.h \
        _extensions/piano-bridge/app/app/src/main/cpp/VoiceHost.cpp
git commit -m "feat(piano-bridge): fail-closed render gate in VoiceHost"
```

---

## Task 4: Stop `OboeOutput` reopening on the built-in speaker

`OboeOutput::onErrorAfterClose` currently does an unconditional `stop(); start();`. When A2DP drops, Android closes the stream and this reopens it on the default route — the tablet speaker. This is the bug that makes a dropout audible.

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/OboeOutput.cpp:84-91`

**Step 1: Never reopen from the error callback**

> **Revised 2026-07-09 after code review.** The first version of this task consulted the gate (`if (!host_->outputGate()) return;`) before reopening. That is WRONG, and subtly so. The event that fires `onErrorAfterClose` *is* the A2DP drop — the same event that closes the gate, arriving via a slower Java broadcast on a different thread with no ordering guarantee. Oboe detects its own HAL-level disconnect first, so the handler observes a still-open gate, reopens onto the only remaining route (the built-in speaker), and `render()` emits synth audio out the tablet until the reconciler catches up. Reopening must not be conditional on the gate; it must not happen here **at all**.

```cpp
void OboeOutput::onErrorAfterClose(oboe::AudioStream* /*stream*/, oboe::Result error) {
    // Do NOT reopen here. This callback fires on the A2DP drop itself, racing the
    // Java-side gate close — reopening would land the stream on the built-in speaker
    // and emit audio out the tablet. Recovery is the reconciler's job: it reopens via
    // PianoEngine.start() only after re-confirming the A2DP route (isStreamRunning()).
    LOGW("Oboe stream error after close: %s — leaving stream closed",
         oboe::convertToText(error));
    stop();
}
```

Cost: a transient, non-disconnect stream error no longer self-heals instantly — it heals on the next `reconcile()` (≤20 s, or immediately on the next `AudioDeviceCallback`). That is the correct trade. Silence is recoverable; audio out the wrong speaker is not.

**Step 2: Build**

Run: `./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

**Step 3: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/cpp/OboeOutput.cpp
git commit -m "fix(piano-bridge): don't reopen Oboe stream onto built-in speaker after A2DP drop"
```

---

## Task 5: JNI plumbing for the gate

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/native-lib.cpp`
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/PianoEngine.java`

**Step 1: Native entry point**

Append to `native-lib.cpp`, following the existing `Java_net_kckern_pianobridge_PianoEngine_*` pattern (note `nativeXruns` at line 131 for the handle-unwrapping idiom to copy):

```cpp
extern "C" JNIEXPORT void JNICALL
Java_net_kckern_pianobridge_PianoEngine_nativeSetOutputGate(
        JNIEnv* /*env*/, jclass /*clazz*/, jlong handle, jboolean open) {
    auto* b = reinterpret_cast<NativeBundle*>(handle);
    if (!b) return;
    b->host->setOutputGate(open == JNI_TRUE);
}
```

Match the actual bundle field names in `native-lib.cpp` — read them, do not assume `b->host`.

**Step 2: Java facade**

In `PianoEngine.java`, add next to `panic()`:

```java
    /**
     * Open/close the fail-closed output gate. Closed = VoiceHost renders silence
     * regardless of engine state. Cheap and idempotent; called by the reconciler.
     */
    public synchronized void setOutputGate(boolean open) {
        if (handle == 0L) return;
        nativeSetOutputGate(handle, open);
    }
```

and to the native declarations block:

```java
    private static native void nativeSetOutputGate(long handle, boolean open);
```

**Step 3: Build**

Run: `./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL. A JNI name mismatch surfaces at runtime, not compile time — Task 9 catches it.

**Step 4: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/cpp/native-lib.cpp \
        _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/PianoEngine.java
git commit -m "feat(piano-bridge): JNI setOutputGate"
```

---

## Task 5b: Make stream restart possible and idempotent

**Discovered during implementation, 2026-07-09.** Task 4 stops `onErrorAfterClose` from reopening the stream while the gate is closed. But **nothing reopens it when the gate opens again.** `engine.start()` is reachable only from `PianoBridgeService.engineStart()` (line ~171), which early-returns on `if (engineRunning) return;` — and `engineRunning` is still `true`, because only the *native* stream closed. Result: after the first A2DP dropout the tablet is silent **forever**, including after the piano reconnects. The guard would appear to work and would in fact have bricked the audio.

Separately, `OboeOutput::start()` is not idempotent: it calls `openStream()` unconditionally, which overwrites the `stream_` shared_ptr and orphans any existing stream. The reconciler runs every 20 s, so a non-idempotent start would tear down and reopen a healthy stream on every sweep, producing an audible gap.

Both must be fixed before Task 7 wires the gate to anything.

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/OboeOutput.cpp` (`start`)
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/OboeOutput.h`
- Modify: `_extensions/piano-bridge/app/app/src/main/cpp/native-lib.cpp`
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/PianoEngine.java`

**Step 1: `isRunning()` on `OboeOutput`** (header, inline):

```cpp
    /** True iff a stream exists and is Started. Lets the reconciler stay idempotent. */
    bool isRunning() const {
        return stream_ && stream_->getState() == oboe::StreamState::Started;
    }
```

**Step 2: Make `start()` idempotent** in `OboeOutput.cpp`:

```cpp
bool OboeOutput::start() {
    if (isRunning()) return true;   // idempotent: the 20s sweep must not churn the stream
    if (stream_) stop();            // a closed/errored stream lingers; drop it before reopening
    if (!openStream()) return false;
    oboe::Result result = stream_->requestStart();
    ...
```

**Step 3: Expose it** — add `nativeIsStreamRunning(long)` in `native-lib.cpp` (using the existing `fromHandle()` idiom and guarding `b->output`), and `public synchronized boolean isStreamRunning()` on `PianoEngine`.

**Step 4: Test** — no JVM test can reach this (it is native + device). Verified in Task 9 Step 6.

**Step 5: Commit**

```bash
git commit -m "fix(piano-bridge): idempotent Oboe start + isRunning, so the gate can reopen a closed stream"
```

Task 7's `setSynthGate` then becomes:

```java
    @Override public void setSynthGate(boolean open) {
        if (engine == null) return;
        engine.setOutputGate(open);
        // Reopening is safe and idempotent: start() no-ops when already running. Without
        // this, a stream closed by an A2DP drop (Task 4) would never reopen on reconnect.
        if (open && !engine.isStreamRunning()) engine.start();
    }
```

---

## Task 6: `AudioRouteGuard` — observe, decide, reconcile

The Android-facing half. It observes, calls `AudioGuardPolicy`, and applies. It is idempotent: calling `reconcile()` twice changes nothing the second time.

**Files:**
- Create: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/AudioRouteGuard.java`
- Test: `_extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/AudioRouteGuardTest.java`

Inject the Android surface behind an interface so the reconciler is JVM-testable.

**Step 1: Write the failing test**

```java
package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class AudioRouteGuardTest {

    /** Fake of the Android surface: records what the guard did. */
    static class FakeOps implements AudioRouteGuard.Ops {
        boolean a2dpConnected, a2dpOut, wired;
        int speakerIndex = 15;
        Boolean lastGate = null;
        int clampCalls = 0;

        public boolean a2dpProfileConnected() { return a2dpConnected; }
        public boolean a2dpOutputPresent()    { return a2dpOut; }
        public boolean wiredOutputPresent()   { return wired; }
        public int  speakerMusicIndex()       { return speakerIndex; }
        public void clampSpeakerMusicVolume() { clampCalls++; speakerIndex = 0; }
        public void setSynthGate(boolean open) { lastGate = open; }
    }

    @Test public void disconnected_clampsOnceThenIsIdempotent() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);

        g.reconcile();
        assertEquals(1, ops.clampCalls);
        assertEquals(Boolean.FALSE, ops.lastGate);
        assertFalse(g.routeOk());
        assertEquals("no_a2dp_output", g.reason());

        g.reconcile(); // speakerIndex is now 0 — must not write again
        assertEquals(1, ops.clampCalls);
    }

    @Test public void connected_opensGateAndNeverRestoresVolume() {
        FakeOps ops = new FakeOps();
        ops.speakerIndex = 0; // already clamped by a previous drop
        AudioRouteGuard g = new AudioRouteGuard(ops);
        ops.a2dpConnected = true; ops.a2dpOut = true;

        g.reconcile();
        assertTrue(g.routeOk());
        assertEquals(Boolean.TRUE, ops.lastGate);
        assertEquals(0, ops.clampCalls);
        assertEquals(0, ops.speakerIndex); // NEVER restored
    }

    @Test public void strayVolumeRaise_isStompedBackToZero() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);
        g.reconcile();
        assertEquals(1, ops.clampCalls);

        ops.speakerIndex = 9;   // someone pressed volume-up
        g.reconcile();
        assertEquals(2, ops.clampCalls);
        assertEquals(0, ops.speakerIndex);
    }

    @Test public void gateStartsClosedBeforeAnyReconcile() {
        assertFalse(new AudioRouteGuard(new FakeOps()).routeOk());
    }

    @Test public void override_opensGateWithoutRestoringVolume() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);
        g.reconcile();
        assertEquals(Boolean.FALSE, ops.lastGate);

        g.setOverrideUntil(Long.MAX_VALUE);
        g.reconcile();
        assertEquals(Boolean.TRUE, ops.lastGate);
        assertEquals("override", g.reason());
        assertEquals(1, ops.clampCalls); // volume floor still enforced
    }
}
```

Note the last test's intent: the override reopens the **synth** gate for debugging but does **not** unclamp the speaker. There is no code path that raises the speaker index. That is deliberate — an escape hatch that could restore tablet-speaker audio would defeat the guard.

**Step 2: Run to verify failure**

Run: `./gradlew :app:testDebugUnitTest --tests '*AudioRouteGuardTest*'`
Expected: FAIL — `cannot find symbol: class AudioRouteGuard`.

**Step 3: Implement**

```java
package net.kckern.pianobridge;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * AudioRouteGuard — the reconciler. Observes the audio route via Ops, asks
 * AudioGuardPolicy what should be true, and makes it so. Idempotent by design:
 * it reasserts desired state from observed state rather than reacting to edges,
 * so a missed broadcast costs one sweep interval, not a permanently wrong state.
 *
 * Fail-closed: routeOk starts false and the synth gate starts closed.
 *
 * The speaker volume is clamped to 0 and NEVER restored. AudioService persists the
 * per-device index, so after the first clamp the built-in speaker is silent forever
 * — across reconnects, process death, and reboots. See the plan doc for why this is
 * the only lever that reaches Chromium WebView audio on API 29.
 */
public final class AudioRouteGuard {

    private static final String TAG = "PianoBridge-audioguard";

    /** The Android surface, injected so the reconciler is unit-testable. */
    public interface Ops {
        boolean a2dpProfileConnected();
        boolean a2dpOutputPresent();
        boolean wiredOutputPresent();
        int  speakerMusicIndex();
        void clampSpeakerMusicVolume();
        void setSynthGate(boolean open);
    }

    private final Ops ops;
    private volatile boolean routeOk = false;
    private volatile String  reason  = "init";
    private volatile long    overrideUntilMs = 0L;
    private volatile int     clamps  = 0;

    public AudioRouteGuard(Ops ops) { this.ops = ops; }

    public boolean routeOk() { return routeOk; }
    public String  reason()  { return reason; }

    /** Time-boxed debug override: reopens the SYNTH gate only. Never unclamps volume. */
    public void setOverrideUntil(long epochMs) { this.overrideUntilMs = epochMs; }

    /** Idempotent. Safe to call from any thread, as often as you like. */
    public synchronized void reconcile() {
        AudioGuardPolicy.World w = new AudioGuardPolicy.World(
                ops.a2dpProfileConnected(),
                ops.a2dpOutputPresent(),
                ops.wiredOutputPresent(),
                ops.speakerMusicIndex());

        AudioGuardPolicy.Decision d = AudioGuardPolicy.decide(w);

        // The volume floor is NEVER waived, override or not.
        if (d.clampSpeakerVolume) {
            ops.clampSpeakerMusicVolume();
            clamps++;
            Diag.log(TAG, "clamped built-in speaker STREAM_MUSIC to 0 (reason=" + d.reason + ")");
        }

        boolean overriding = System.currentTimeMillis() < overrideUntilMs;
        boolean gateOpen = d.routeOk || overriding;

        if (routeOk != d.routeOk || !reasonEquals(d, overriding)) {
            Diag.log(TAG, "route " + (d.routeOk ? "OK" : "GATED")
                    + " reason=" + d.reason + (overriding ? " (override)" : ""));
        }
        routeOk = d.routeOk;
        reason  = overriding && !d.routeOk ? "override" : d.reason;
        ops.setSynthGate(gateOpen);
    }

    private boolean reasonEquals(AudioGuardPolicy.Decision d, boolean overriding) {
        String next = overriding && !d.routeOk ? "override" : d.reason;
        return next.equals(reason);
    }

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("routeOk", routeOk);
            o.put("gated", !routeOk);
            o.put("reason", reason);
            o.put("clamps", clamps);
            o.put("overrideActive", System.currentTimeMillis() < overrideUntilMs);
        } catch (JSONException ignored) { }
        return o;
    }
}
```

**Step 4: Run to verify pass**

Run: `./gradlew :app:testDebugUnitTest --tests '*AudioRouteGuardTest*'`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/AudioRouteGuard.java \
        _extensions/piano-bridge/app/app/src/test/java/net/kckern/pianobridge/AudioRouteGuardTest.java
git commit -m "feat(piano-bridge): idempotent audio-route reconciler"
```

---

## Task 7: Wire the guard into the service

Provide the real `Ops`, and drive `reconcile()` from four independent triggers so no single missed signal leaves the guard wrong.

**Files:**
- Create: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/AndroidAudioOps.java`
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/PianoBridgeService.java` (fields ~line 59; `startBleMidi()` ~line 251; `onDestroy()` ~line 289)
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/A2dpConnector.java` (`stateReceiver`, `scheduleSweep`)

**Step 1: Implement `AndroidAudioOps`**

```java
package net.kckern.pianobridge;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

/**
 * AndroidAudioOps — the real Ops. Note the API-29 constraint: there is NO public
 * way to query the ACTIVE output route (getDevicesForAttributes is @SystemApi
 * until API 31). We infer the built-in speaker is active iff neither an A2DP nor
 * a wired output device is connected. Sound for a tablet sealed in an antitheft
 * box with no headphone access. Verified against `dumpsys audio` ground truth.
 */
public final class AndroidAudioOps implements AudioRouteGuard.Ops {

    private final AudioManager am;
    private final A2dpConnector a2dp;
    private final PianoEngine engine;

    public AndroidAudioOps(Context ctx, A2dpConnector a2dp, PianoEngine engine) {
        this.am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        this.a2dp = a2dp;
        this.engine = engine;
    }

    @Override public boolean a2dpProfileConnected() {
        return a2dp != null && a2dp.isTargetConnected();
    }

    @Override public boolean a2dpOutputPresent() {
        return hasType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
    }

    /**
     * Any non-A2DP, non-built-in output. AudioGuardPolicy suppresses the volume clamp
     * when this is true, because setStreamVolume would then write THAT device's index
     * instead of the speaker's. Under-reporting here zeroes the wrong device's volume,
     * so err on the side of listing a type. (Reviewer flagged: a USB DAC classified as
     * anything but wired is the one path that corrupts the wrong index.)
     */
    @Override public boolean wiredOutputPresent() {
        return hasType(AudioDeviceInfo.TYPE_WIRED_HEADSET)
            || hasType(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
            || hasType(AudioDeviceInfo.TYPE_USB_HEADSET)
            || hasType(AudioDeviceInfo.TYPE_USB_DEVICE)
            || hasType(AudioDeviceInfo.TYPE_USB_ACCESSORY)
            || hasType(AudioDeviceInfo.TYPE_LINE_ANALOG)
            || hasType(AudioDeviceInfo.TYPE_LINE_DIGITAL)
            || hasType(AudioDeviceInfo.TYPE_AUX_LINE)
            || hasType(AudioDeviceInfo.TYPE_HDMI)
            || hasType(AudioDeviceInfo.TYPE_DOCK);
    }

    @Override public int speakerMusicIndex() {
        // No per-device getter on API 29. While the speaker is the active route this
        // returns the speaker's index, which is exactly when the policy consults it.
        return am == null ? 0 : am.getStreamVolume(AudioManager.STREAM_MUSIC);
    }

    @Override public void clampSpeakerMusicVolume() {
        if (am == null) return;
        // Writes the index of the ACTIVE device. The policy only sets clamp=true when
        // the speaker is the inferred active route, so this cannot clamp the piano.
        am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
    }

    @Override public void setSynthGate(boolean open) {
        if (engine != null) engine.setOutputGate(open);
    }

    private boolean hasType(int type) {
        if (am == null) return false;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getType() == type) return true;
        }
        return false;
    }
}
```

**Step 2: Expose `isTargetConnected()` on `A2dpConnector`**

`isConnected(BluetoothDevice)` is private and takes a device. Add a public no-arg accessor beside `status()`, reusing the existing logic rather than duplicating it (`status()` already does this dance — extract it):

```java
    /** True iff the configured speaker MAC is currently A2DP-connected. */
    public boolean isTargetConnected() {
        String mac = cfg.speakerMac();
        if (adapter == null || mac.isEmpty()) return false;
        try { return isConnected(adapter.getRemoteDevice(mac)); }
        catch (Exception e) { return false; }
    }
```

Then rewrite `status()` to call it, so there is one source of truth.

**Step 3: Drive `reconcile()` from four triggers**

In `A2dpConnector`, hold an optional `Runnable onStateChanged` and invoke it (a) at the end of `ensureConnected()`'s periodic sweep, and (b) from `stateReceiver` on **both** `STATE_CONNECTED` and `STATE_DISCONNECTED`. Set it from `PianoBridgeService`.

In `PianoBridgeService`:

- Field: `private AudioRouteGuard audioGuard;`
- In `startBleMidi()`, immediately after the `a2dpConnector` block (line ~257), construct the guard once the engine exists, then `audioGuard.reconcile();`
- Register a `BroadcastReceiver` for `"android.media.VOLUME_CHANGED_ACTION"` that calls `audioGuard.reconcile()` — this stomps a stray volume-up.
- Register an `AudioManager.registerAudioDeviceCallback(...)` whose `onAudioDevicesAdded`/`Removed` both call `audioGuard.reconcile()`.
- In `onDestroy()`, unregister both and null the guard.
- Add `public AudioRouteGuard getAudioGuard() { return audioGuard; }`

Reconcile on: service start, A2DP state change, `AudioDeviceCallback`, the 20 s sweep, and `VOLUME_CHANGED_ACTION`. Any one of them alone is sufficient; together the worst-case exposure is one sweep interval.

**Step 4: Build and run the full unit suite**

Run: `./gradlew :app:assembleDebug :app:testDebugUnitTest`
Expected: BUILD SUCCESSFUL; all tests pass.

**Step 5: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/
git commit -m "feat(piano-bridge): wire audio guard into service lifecycle"
```

---

## Task 8: Bootstrap the clamp, and expose status

The clamp can only land while the speaker is the active route. Rather than wait for a real dropout mid-hymn, spend the one-time exposure window deliberately: force-disconnect A2DP, let the guard clamp, reconnect.

**Files:**
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/ControlServer.java` (`/speaker` ~line 168; route help ~line 118)
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/A2dpConnector.java`
- Modify: `_extensions/piano-bridge/pbctl.mjs`

**Step 1: Add `disconnectNow()` to `A2dpConnector`**

Mirror the existing reflection idiom used for `connect` (`BluetoothA2dp.class.getMethod("connect", ...)`), with `"disconnect"`. Both are `@hide` but greylisted at targetSdk 29.

**Step 2: Extend `/speaker` and add the bootstrap + override routes**

In `ControlServer.serveHttp`:

```java
                case "/speaker": {
                    A2dpConnector spk = service.getA2dpConnector();
                    if (spk == null) return json(err("no_a2dp"));
                    if (method == NanoHTTPD.Method.POST) { spk.connectNow(); return json(ok().put("action", "speaker_connect")); }
                    JSONObject o = ok().put("speaker", spk.status());
                    AudioRouteGuard g = service.getAudioGuard();
                    o.put("guard", g != null ? g.status() : JSONObject.NULL);
                    return json(o);
                }
                case "/audio-guard/bootstrap": {
                    // Spend the one-time exposure window on purpose: drop A2DP, let the
                    // reconciler clamp the speaker index to 0, then reconnect. After this
                    // the speaker is silent permanently (AudioService persists the index).
                    A2dpConnector spk = service.getA2dpConnector();
                    AudioRouteGuard g = service.getAudioGuard();
                    if (spk == null || g == null) return json(err("not_ready"));
                    spk.disconnectNow();
                    Thread.sleep(1500);   // let the route fall back to the speaker
                    g.reconcile();        // clamp lands here
                    spk.connectNow();
                    return json(ok().put("action", "bootstrap").put("guard", g.status()));
                }
                case "/audio-guard/override": {
                    AudioRouteGuard g = service.getAudioGuard();
                    if (g == null) return json(err("not_ready"));
                    String ms = session.getParms().get("ms");
                    long dur = Math.min(600000L, Math.max(0L, ms == null ? 60000L : Long.parseLong(ms)));
                    g.setOverrideUntil(System.currentTimeMillis() + dur);
                    g.reconcile();
                    return json(ok().put("overrideMs", dur).put("guard", g.status()));
                }
```

Add both to the `/help` route list. The override reopens the synth gate only; it never raises the speaker index.

**Step 3: Surface in `pbctl`**

Add a `speaker` subcommand printing `guard.routeOk / guard.reason / guard.clamps`, and include the same in `diag()`'s bridge section (`pbctl.mjs:166` already prints `speaker=on|off` — extend it with `guard=ok|gated:<reason>`).

**Step 4: Build, install, verify the routes answer**

```bash
./gradlew :app:assembleDebug
# deploy via the ADB-free path (see README "Self-update"), then:
curl -s $PB/speaker | python3 -m json.tool
```
Expected: a `guard` object with `routeOk: true`, `reason: "ok"` (speaker is currently connected).

**Step 5: Commit**

```bash
git add _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/ControlServer.java \
        _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/A2dpConnector.java \
        _extensions/piano-bridge/pbctl.mjs
git commit -m "feat(piano-bridge): audio-guard status, bootstrap, and time-boxed override"
```

---

## Task 9: Hardware verification — prove BOTH states

@superpowers:verification-before-completion applies. A guard verified only in its closed state is not verified. Do not claim this works until every expectation below is observed.

Bump `versionCode` to `18` in `app/build.gradle` before deploying — `PackageInstaller` self-update rejects a non-increasing `versionCode`.

**Step 1: Baseline — gate open, audio on the piano**

```bash
curl -s $PB/speaker | python3 -m json.tool
curl -s "$PB/exec?cmd=dumpsys%20audio" | python3 -c "import sys,json;[print(l) for l in json.load(sys.stdin)['stdout'].splitlines() if 'Devices:' in l or 'STREAM_MUSIC' in l]"
```
Expected: `guard.routeOk: true`, `reason: "ok"`; `dumpsys audio` shows `Devices: bt_a2dp`. Play a note; it sounds from the piano.

**Step 2: Verify the JNI binding is live**

A `nativeSetOutputGate` name mismatch throws `UnsatisfiedLinkError` at first call, not at build.

```bash
curl -s "$PB/logcat?lines=200&tag=PianoBridge-audioguard"
```
Expected: `route OK reason=ok` entries, and **no** `UnsatisfiedLinkError` anywhere in `curl -s "$PB/logcat?lines=400"`.

**Step 3: Measure `AudioDeviceCallback` latency (the open unknown)**

Start a logcat tail, then force a disconnect, then correlate timestamps:

```bash
curl -s "$PB/exec?cmd=dumpsys%20bluetooth_manager" > /tmp/bt-before.json
curl -s -X POST "$PB/audio-guard/bootstrap"
curl -s "$PB/logcat?lines=300" | grep -E 'A2DPSVC-Connection state|PianoBridge-audioguard|PianoBridge-oboe'
```
Record the delta between the `A2DPSVC-Connection state ...: 1->0` line and the guard's `clamped built-in speaker` line. **Write the measured value into `DESIGN.md`.** If it exceeds ~500 ms, note it as the size of the one-time window; it does not affect steady-state correctness.

**Step 4: Confirm the clamp landed and is persistent**

```bash
curl -s "$PB/getsetting?ns=system&key=volume_music_speaker"   # expect value "0"
curl -s "$PB/getsetting?ns=system&key=volume_music_bt_a2dp"   # expect value "15" — untouched
```
Expected: speaker `0`, A2DP `15`. **If `volume_music_bt_a2dp` is `0`, the clamp hit the wrong device — stop and fix the policy's `speakerIsRoute` inference before going further.**

**Step 5: The real test — disconnect and listen**

With the piano playing, force a disconnect and confirm silence from the tablet:

```bash
curl -s "$PB/exec?cmd=dumpsys%20audio" | grep -A6 'STREAM_MUSIC'
```
Expected: `Devices: speaker`, and the speaker index reads `0`. Hold a chord; the tablet emits **nothing**. Then confirm the WebView path: trigger a game SFX or `MusicPlayer.jsx` track while disconnected — also silent. This is the requirement; if the tablet makes any sound here, the guard has failed.

**Step 6: Reconnect and confirm recovery**

```bash
curl -s -X POST $PB/speaker
sleep 5 && curl -s $PB/speaker | python3 -m json.tool
```
Expected: `guard.routeOk: true`, audio returns **through the piano**, and `volume_music_speaker` is still `0`.

Note: this is the first time `A2dpConnector.connect()` will have been exercised against a *bonded* device — every one of its 5,153 prior attempts was against an unbonded one and failed. If reconnect does not work, that is a **pre-existing** defect this plan surfaced, not one it introduced. Fix it here; the guard is useless if the route can never come back.

**Step 7: Reboot survival**

```bash
curl -s "$PB/exec?cmd=reboot" || true   # or power-cycle
# after boot:
curl -s "$PB/getsetting?ns=system&key=volume_music_speaker"   # expect "0"
curl -s $PB/speaker | python3 -m json.tool                     # expect routeOk true
```

**Step 8: Commit the verification record**

Append the measured latency and the observed `dumpsys` output to `DESIGN.md`, then commit.

---

## Task 10: Correct the documentation

Three claims in the repo are now known to be false. Leaving them costs the next engineer a day.

**Files:**
- Modify: `_extensions/piano-bridge/DESIGN.md`
- Modify: `_extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/SettingsControl.java:11-15`
- Modify: `_extensions/piano-bridge/README.md`

**Step 1: Fix `DESIGN.md`**

- The "Deploy & Diagnostics" section says **"SELinux blocks `dumpsys` (any service)"** and "`DUMP` is useless." Both `dumpsys audio` and `dumpsys bluetooth_manager` work via `/exec`. Correct it and name the services confirmed working.
- The "Service lifecycle" section says `PianoBridgeService` "does **not** call `startForeground()`." It does — see `postNotification()`. The comment in the source already contradicts the design doc. Fix the doc.
- Add an **Audio guard** section: the four layers, the fail-closed invariant, the "clamp once, never restore" rule, and the measured `AudioDeviceCallback` latency from Task 9.

**Step 2: Fix `SettingsControl`'s doc comment**

It claims `Settings.{Secure,Global,System}.putString` is a general ADB-free replacement for `settings put`. Per-device volume keys (`volume_music_speaker` et al.) are readable but **not** writable — `putString` throws `"You cannot keep your settings in the secure settings."` Document the exception so nobody re-attempts it.

**Step 3: Record the invariant in `README.md`**

One paragraph: the tablet's built-in speaker `STREAM_MUSIC` index is pinned to 0 permanently and intentionally. Never restore it. If someone finds the tablet silent with the piano disconnected, that is the guard working. `POST /audio-guard/override?ms=60000` reopens the synth gate for debugging without unclamping the volume.

**Step 4: Commit**

```bash
git add _extensions/piano-bridge/DESIGN.md _extensions/piano-bridge/README.md \
        _extensions/piano-bridge/app/app/src/main/java/net/kckern/pianobridge/SettingsControl.java
git commit -m "docs(piano-bridge): correct dumpsys/startForeground/settings-write claims; document audio guard"
```

---

## Deferred, deliberately

- **Restoring the speaker volume.** No code path raises the built-in speaker index. Adding one would defeat the guard. If the tablet ever legitimately needs speaker audio, do it manually and knowingly.
- **`A2dpConnector` reconnect hardening.** Its `connect()` has never demonstrably worked. Task 9 Step 6 is the first real test. If it proves unreliable against a bonded device, that is a separate fix with its own plan — but the guard's correctness does not depend on it.
- **Frontend surfacing.** `routeOk`/`reason` are exposed over HTTP but not shown in the kiosk UI. Worth doing once the guard has run for a week, so the UI reflects real failure modes rather than guessed ones.

---

## Verification results (measured on hardware, 2026-07-09)

Shipped as APK versionCode **18** / versionName `1.10-audio-guard`, deployed to the
live SM-T590 and exercised end to end. All figures below are from hardware, not a
simulator.

### Bootstrap trace (the one-time exposure window)

From the `Diag` ring (monotonic ms since boot) during `POST /audio-guard/bootstrap`:

```
77584336  A2DP disconnect(64:49:A5:8B:9B:75) -> true
77584970  clamped built-in speaker STREAM_MUSIC to 0 (reason=no_a2dp_output)   +634 ms
77584970  route GATED reason=no_a2dp_output
77585032  A2DP "speaker disconnected — reconnecting (#1)"                      +696 ms
77586889  connect(64:49:A5:8B:9B:75) -> true
77587636  speaker connected
77588102  route OK reason=ok
```

- **`AudioDeviceCallback` fired ~634 ms after the disconnect and LED the A2DP
  broadcast by ~62 ms** — it is the fast trigger. This bounds the one-time exposure
  window only, not steady-state latency.
- Full outage (disconnect → route OK again): **~3.8 s**.
- The bootstrap endpoint's own `reconcile()` ran ~1.9 s after the clamp and did
  **not** re-clamp (`clamps` stayed 1) — the policy's idempotent `speakerIndex > 0`
  guard, exercised on real hardware.

### Clamp landed on the right device

- Per-device indices after the clamp: `volume_music_speaker=0`,
  `volume_music_bt_a2dp=15`, `volume_music_headset=8`. Only the speaker was zeroed.
- `dumpsys audio` after: `2 (speaker): 0\0`, `80 (bt_a2dp): 15\150`,
  `Devices: bt_a2dp`.
- Zero `UnsatisfiedLinkError` — both `nativeSetOutputGate` and
  `nativeIsStreamRunning` bind at runtime.

### Reconnect: `A2dpConnector.connect()` works against a BONDED device

The historical `reconnects: 5153` were **all** failures against an UNBONDED MAC
(`bondState: none`), which the code reported in `lastError` ("speaker not bonded")
where nothing surfaced it. Against the bonded speaker, `connect()` succeeded.
**Recommendation:** surface `lastError` in `pbctl diag` so the next investigator
sees why a reconnect failed instead of re-deriving it.

### Reboot survival: INFERRED, NOT VERIFIED

The clamped value lives in the `Settings.System` DB — the store `AudioService`
reads at boot — and was still `0` half an hour after the clamp, but the tablet did
NOT reboot during this session (`uptimeMs` ≈ 21.7 h, same PID throughout). Treat
reboot survival as **inferred, not verified**. One-line check after the next reboot:

```bash
curl -s "http://<tablet>:8770/getsetting?ns=system&key=volume_music_speaker"   # want 0
```

### Fail-closed policy held under an unanticipated config

During the deploy the on-device config override was clobbered down to a single key
(see below), leaving `speakerMac` empty. With no `speakerMac` the guard correctly
**refused to clamp** (an A2DP output device was present → `speakerIsRoute` false):
gated, but no wrongful volume write. The fail-closed policy held under a config it
never anticipated.

### Deployment findings

- **Deploy is a PULL.** `GET|POST /update?url=<apk-url>` makes the bridge fetch the
  APK over HTTP, so it must be served on the LAN — there is no upload endpoint.
  `versionCode` must strictly increase (now 18).
- **Install needs one physical tap** (FKB is not device owner). The `/update`
  endpoint blocks past a 25 s curl timeout while waiting on the confirm dialog — a
  client timeout does **NOT** mean the install failed.
- **ADB over WiFi was unavailable.** Port 5555 was refused after a reboot,
  `setprop service.adb.tcp.port` is denied to `untrusted_app`, and although
  `adb_enabled=1` it was USB-only. Plan for the `/update` (pull) path.
- **The service does not auto-start after a replace-install** (fresh-install stopped
  state). Relaunch ADB-free with `node cli/fkb.cli.mjs launch net.kckern.pianobridge`.
- **OPEN BUG — config clobber.** The replace-install clobbered the on-device config
  override at `/data/user/0/net.kckern.pianobridge/files/piano-devices.yml` down to a
  single key (`fkbWakeSuppressUntilEpochMs`), losing `speakerMac`, `targetMac`,
  `targetName`, `blocklistMacs`, ports, and timeouts. **Back up `GET /config` before
  every install** and restore with `POST /config` (YAML body). Worth a separate fix.
