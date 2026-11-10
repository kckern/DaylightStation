package net.kckern.pianobridge;

import java.util.ArrayDeque;
import java.util.function.LongSupplier;

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
 * HFP link. If Android refuses the priority write it is asked {@link #MAX_PRIORITY_TRIES}
 * times, then the guard falls back to disconnecting HFP whenever it reappears — capped
 * at {@link #MAX_DISCONNECTS_PER_HOUR}, so a flapping HFP cannot itself destabilise the
 * module. The A2DP link is never touched.
 */
public final class HeadsetGuard {

    static final int MAX_PRIORITY_TRIES = 3;
    static final int MAX_DISCONNECTS_PER_HOUR = 10;
    private static final long HOUR_MS = 60 * 60_000L;

    /** The Android surface, injected so the reconciler is unit-testable. */
    public interface Ops {
        boolean ready();
        boolean headsetConnected();
        /** @return null when the priority cannot be read */
        Boolean headsetPriorityOff();
        boolean setHeadsetPriorityOff();
        boolean disconnectHeadset();
    }

    public static final class Outcome {
        /** something was attempted */
        public final boolean acted;
        /** something actually changed: priority newly off, or a link dropped — the only thing worth logging */
        public final boolean changed;
        public final boolean priorityOff, disconnected;
        /** the hourly disconnect cap was reached on this call (reported once per cap) */
        public final boolean capJustHit;
        Outcome(boolean acted, boolean changed, boolean priorityOff, boolean disconnected, boolean capJustHit) {
            this.acted = acted; this.changed = changed; this.priorityOff = priorityOff;
            this.disconnected = disconnected; this.capJustHit = capJustHit;
        }
    }

    /** Last observed state, for status without fresh binder calls. Nulls mean unknown. */
    public static final class Snapshot {
        public final Boolean connected, priorityOff;
        public final int disconnects;
        public final boolean priorityGivenUp, capped;
        Snapshot(Boolean connected, Boolean priorityOff, int disconnects, boolean priorityGivenUp, boolean capped) {
            this.connected = connected; this.priorityOff = priorityOff; this.disconnects = disconnects;
            this.priorityGivenUp = priorityGivenUp; this.capped = capped;
        }
    }

    private final Ops ops;
    private final LongSupplier clock;
    private final ArrayDeque<Long> recentDisconnects = new ArrayDeque<>();
    private int disconnects = 0;
    private int priorityTries = 0;
    private boolean capReported = false;
    private Boolean lastConnected = null, lastPriorityOff = null;

    public HeadsetGuard(Ops ops) { this(ops, System::currentTimeMillis); }
    public HeadsetGuard(Ops ops, LongSupplier clock) { this.ops = ops; this.clock = clock; }

    public synchronized int disconnects() { return disconnects; }

    public synchronized Snapshot snapshot() {
        return new Snapshot(lastConnected, lastPriorityOff, disconnects,
                priorityTries >= MAX_PRIORITY_TRIES && !Boolean.TRUE.equals(lastPriorityOff), capReported);
    }

    /** Idempotent. */
    public synchronized Outcome reconcile() {
        if (!ops.ready()) return new Outcome(false, false, false, false, false);
        boolean acted = false, changed = false;

        Boolean priorityOff = ops.headsetPriorityOff();
        if (!Boolean.TRUE.equals(priorityOff) && priorityTries < MAX_PRIORITY_TRIES) {
            priorityTries++;
            acted = true;
            if (ops.setHeadsetPriorityOff()) { priorityOff = Boolean.TRUE; changed = true; }
        }
        lastPriorityOff = priorityOff;

        boolean connected = ops.headsetConnected();
        boolean disconnected = false, capJustHit = false;
        if (connected) {
            long now = clock.getAsLong();
            while (!recentDisconnects.isEmpty() && now - recentDisconnects.peekFirst() >= HOUR_MS) recentDisconnects.removeFirst();
            if (recentDisconnects.size() >= MAX_DISCONNECTS_PER_HOUR) {
                if (!capReported) { capReported = true; capJustHit = true; }
            } else {
                capReported = false;
                acted = true;
                disconnected = ops.disconnectHeadset();
                if (disconnected) {
                    disconnects++;
                    recentDisconnects.addLast(now);
                    connected = false;
                    changed = true;
                }
            }
        }
        lastConnected = connected;
        return new Outcome(acted, changed, Boolean.TRUE.equals(priorityOff), disconnected, capJustHit);
    }
}
