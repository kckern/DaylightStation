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
        void clampSpeakerMusicVolume();
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

    public AudioRouteGuard(Ops ops) { this(ops, System::currentTimeMillis); }
    public AudioRouteGuard(Ops ops, LongSupplier clock) { this.ops = ops; this.clock = clock; }

    int clampLogs() { return clampLogs; }

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

        // The volume floor is NEVER waived, override or not — and never rate-limited.
        // Only the LOG is: a fighting writer (FKB volumeLevels, 2026-10-23) once made
        // this fire ~25x/s and flushed logcat's whole ring in four minutes.
        if (d.clampSpeakerVolume) {
            ops.clampSpeakerMusicVolume();
            clamps++;
            long now = clock.getAsLong();
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
                    + " reason=" + nextReason);
        }
        routeOk = d.routeOk;
        reason  = nextReason;
        ops.setSynthGate(gateOpen);
    }

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
        } catch (JSONException ignored) { }
        return o;
    }
}
