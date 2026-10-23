package net.kckern.pianobridge;

/**
 * HeadsetGuard — keep the piano's built-in Bluetooth speaker A2DP-only.
 *
 * The piano's module ("J2-USB Bluetooth") also offers the Headset (HFP) profile, and
 * Android connects both. The kiosk never makes calls through the piano, and an HFP
 * link is exactly what a microphone open reshuffles (setSpeakerphoneOn / SCO routing):
 * on 2026-10-23 the speaker dropped seconds after three voice-feedback recordings.
 * A module juggling two profiles is also a plausible contributor to its spontaneous
 * L2CAP wedges.
 *
 * Reconciler, like {@link AudioRouteGuard}: from observed state, turn the speaker's
 * HFP priority off (persistent, so Android stops auto-connecting it) and drop any live
 * HFP link. If Android refuses the priority write, disconnecting every time HFP
 * reappears is the fallback — the A2DP link is never touched.
 */
public final class HeadsetGuard {

    /** The Android surface, injected so the reconciler is unit-testable. */
    public interface Ops {
        boolean ready();
        boolean headsetConnected();
        boolean headsetPriorityOff();
        boolean setHeadsetPriorityOff();
        boolean disconnectHeadset();
    }

    public static final class Outcome {
        public final boolean acted, priorityOff, disconnected;
        Outcome(boolean acted, boolean priorityOff, boolean disconnected) {
            this.acted = acted; this.priorityOff = priorityOff; this.disconnected = disconnected;
        }
    }

    private final Ops ops;
    private volatile int disconnects = 0;

    public HeadsetGuard(Ops ops) { this.ops = ops; }

    public int disconnects() { return disconnects; }

    /** Idempotent. */
    public synchronized Outcome reconcile() {
        if (!ops.ready()) return new Outcome(false, false, false);
        boolean acted = false;
        boolean priorityOff = ops.headsetPriorityOff();
        if (!priorityOff) {
            priorityOff = ops.setHeadsetPriorityOff();
            acted = true;
        }
        boolean disconnected = false;
        if (ops.headsetConnected()) {
            disconnected = ops.disconnectHeadset();
            if (disconnected) disconnects++;
            acted = true;
        }
        return new Outcome(acted, priorityOff, disconnected);
    }
}
