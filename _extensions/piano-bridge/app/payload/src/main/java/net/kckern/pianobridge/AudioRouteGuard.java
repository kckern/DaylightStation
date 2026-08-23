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
        String nextReason = overriding && !d.routeOk ? "override" : d.reason;

        if (routeOk != d.routeOk || !nextReason.equals(reason)) {
            Diag.log(TAG, "route " + (d.routeOk ? "OK" : "GATED")
                    + " reason=" + nextReason);
        }
        routeOk = d.routeOk;
        reason  = nextReason;
        ops.setSynthGate(gateOpen);
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
