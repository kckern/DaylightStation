package net.kckern.pianobridge;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.function.LongSupplier;

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
        /** STREAM_MUSIC max index; 0 disables the A2DP floor. */
        int  musicMaxIndex();
        void clampSpeakerMusicVolume();
        /**
         * Raise the ACTIVE device's STREAM_MUSIC index to max, only if A2DP is still the
         * route at the moment of the write, and clamp straight back to 0 if A2DP vanished
         * across the write (it would have landed on the built-in speaker).
         * @return true if the A2DP index was raised
         */
        boolean raiseA2dpMusicVolume();
        void setSynthGate(boolean open);
    }

    private final Ops ops;
    private volatile boolean routeOk = false;
    private volatile String  reason  = "init";
    private volatile long    overrideUntilMs = 0L;
    private volatile int     clamps  = 0;
    private static final long CLAMP_WINDOW_MS = 60_000L;
    private final LongSupplier clock;
    private final ArrayDeque<Long> recentClamps = new ArrayDeque<>();
    private long lastClampLogMs = Long.MIN_VALUE / 2;
    private int  clampLogs = 0;
    private long routeOkSinceMs = -1L;      // -1 = A2DP not currently confirmed
    private volatile int  musicIndex = -1;  // last observed active STREAM_MUSIC index
    private volatile int  musicMax = 0;
    private volatile int  a2dpRaises = 0;
    private volatile long lastA2dpRaiseMs = 0L;
    private volatile int  lastA2dpRaiseFrom = -1;
    private volatile long recheckInMs = 0L;
    private long lastRaiseLogMs = Long.MIN_VALUE / 2;

    public AudioRouteGuard(Ops ops) { this(ops, System::currentTimeMillis); }
    public AudioRouteGuard(Ops ops, LongSupplier clock) { this.ops = ops; this.clock = clock; }

    int clampLogs() { return clampLogs; }

    public boolean routeOk() { return routeOk; }
    public String  reason()  { return reason; }

    /** Time-boxed debug override: reopens the SYNTH gate only. Never unclamps volume. */
    public void setOverrideUntil(long epochMs) { this.overrideUntilMs = epochMs; }

    /** Idempotent. Safe to call from any thread, as often as you like. */
    public synchronized void reconcile() {
        long now = clock.getAsLong();
        boolean a2dpConnected = ops.a2dpProfileConnected();
        boolean a2dpOut = ops.a2dpOutputPresent();
        if (a2dpConnected && a2dpOut) {
            if (routeOkSinceMs < 0) routeOkSinceMs = now;
        } else {
            routeOkSinceMs = -1L;
        }
        int index = ops.speakerMusicIndex();
        int max = ops.musicMaxIndex();
        musicIndex = index;
        musicMax = max;
        AudioGuardPolicy.World w = new AudioGuardPolicy.World(
                a2dpConnected, a2dpOut, ops.wiredOutputPresent(), index, max,
                routeOkSinceMs < 0 ? 0L : now - routeOkSinceMs);

        AudioGuardPolicy.Decision d = AudioGuardPolicy.decide(w);
        recheckInMs = d.recheckInMs;

        // The A2DP floor: "connected" with the piano's own index at 0 is silence that
        // every status surface reports as healthy. Raise it; log what we found.
        if (d.raiseA2dpVolume) {
            if (ops.raiseA2dpMusicVolume()) {
                a2dpRaises++;
                lastA2dpRaiseMs = now;
                lastA2dpRaiseFrom = index;
                musicIndex = max;
                if (now - lastRaiseLogMs >= CLAMP_WINDOW_MS) {
                    Diag.log(TAG, "raised A2DP STREAM_MUSIC " + index + "/" + max + " -> " + max
                            + " (something lowered it; " + a2dpRaises + " raises since start)");
                    lastRaiseLogMs = now;
                }
            } else {
                Diag.log(TAG, "A2DP floor raise skipped: route changed under the write");
            }
        }

        // The volume floor is NEVER waived, override or not — and never rate-limited.
        // Only the LOG is: a fighting writer (FKB volumeLevels, 2026-10-23) once made
        // this fire ~25x/s and flushed logcat's whole ring in four minutes.
        if (d.clampSpeakerVolume) {
            ops.clampSpeakerMusicVolume();
            clamps++;
            recentClamps.addLast(now);
            while (recentClamps.size() > 2000) recentClamps.removeFirst();
            if (now - lastClampLogMs >= CLAMP_WINDOW_MS) {
                int inWindow = countRecent(now);
                Diag.log(TAG, "clamped built-in speaker STREAM_MUSIC to 0 (reason=" + d.reason
                        + (inWindow > 1 ? ", " + inWindow + " clamps in the last minute" : "") + ")");
                lastClampLogMs = now;
                clampLogs++;
            }
        }

        boolean overriding = System.currentTimeMillis() < overrideUntilMs;
        boolean gateOpen = d.routeOk || overriding;
        String nextReason = overriding && !d.routeOk ? "override" : d.reason;

        if (routeOk != d.routeOk || !nextReason.equals(reason)) {
            Diag.log(TAG, "route " + (d.routeOk ? "OK" : "GATED")
                    + " reason=" + nextReason + " musicIndex=" + index + "/" + max);
        }
        routeOk = d.routeOk;
        reason  = nextReason;
        ops.setSynthGate(gateOpen);
    }

    /** >0 when the floor is waiting out A2DP_SETTLE_MS: the caller must reconcile again
     *  after this long, since nothing else will fire on a steady route. */
    public long recheckInMs() { return recheckInMs; }

    int a2dpRaises() { return a2dpRaises; }

    private int countRecent(long now) {
        while (!recentClamps.isEmpty() && now - recentClamps.peekFirst() > CLAMP_WINDOW_MS) recentClamps.removeFirst();
        return recentClamps.size();
    }

    public synchronized JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("routeOk", routeOk);
            o.put("gated", !routeOk);
            o.put("reason", reason);
            o.put("clamps", clamps);
            o.put("clampsPerMin", countRecent(clock.getAsLong()));
            o.put("overrideActive", System.currentTimeMillis() < overrideUntilMs);
            // The active route's index: with routeOk this is the PIANO's volume. 0 here
            // with routeOk=true is the "connected but silent" failure.
            o.put("musicIndex", musicIndex);
            o.put("musicMax", musicMax);
            o.put("a2dpRaises", a2dpRaises);
            if (lastA2dpRaiseMs > 0) {
                o.put("lastA2dpRaiseMs", lastA2dpRaiseMs);
                o.put("lastA2dpRaiseFrom", lastA2dpRaiseFrom);
            }
        } catch (JSONException ignored) { }
        return o;
    }
}
