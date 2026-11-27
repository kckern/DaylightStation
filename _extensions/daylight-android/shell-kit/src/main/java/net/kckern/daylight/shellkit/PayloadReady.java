package net.kckern.daylight.shellkit;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.PayloadStart;

/**
 * The one readiness wait for an installed screen that needs the payload (a link, a tile,
 * the home screen, a capture screen). It waits for the port to attach for as long as the
 * loader itself gives a payload to start, so a tap made while Daylight starts is kept and
 * run, never dropped with "still starting" while the start is still going.
 *
 * Three answers: ready (the port is attached), still starting (the wait ran out with no
 * failure: the words are {@link #STARTING}), failed (the loader gave up: its own reason).
 * The attach is the port's own signal (PayloadPort.awaitReady returns as soon as a handler
 * attaches); a loader failure is read from PayloadStart between half-second slices.
 *
 * Never call on the main thread.
 */
public final class PayloadReady {
    public static final String STARTING = "Starting Daylight…";
    public static final String FAILED_WORDS = "Daylight could not start. Close it and open it again.";

    public enum State { READY, STARTING, FAILED }

    public static final class Answer {
        public final State state;
        /** For FAILED, the loader's reason (for logs: it is not worded for people); otherwise empty. */
        public final String reason;

        Answer(State state, String reason) { this.state = state; this.reason = reason == null ? "" : reason; }

        public boolean ready() { return state == State.READY; }

        /** The line a screen shows for this answer (empty when ready). */
        public String words() { return PayloadReady.words(state, reason); }
    }

    /** What reads the port and the loader. Tests give their own. */
    interface Signals {
        boolean awaitAttach(long waitMs);
        String failure();
        long now();
    }

    private PayloadReady() { }

    /** Waits up to the loader's own deadline ({@link PayloadStart#WAIT_MS}) for {@code port}. */
    public static Answer await(String port) { return await(port, PayloadStart.WAIT_MS); }

    public static Answer await(String port, long waitMs) {
        PayloadPort p = PayloadPort.named(port);
        return await(new Signals() {
            @Override public boolean awaitAttach(long ms) { return p.awaitReady(ms); }
            @Override public String failure() { return PayloadStart.failure(); }
            @Override public long now() { return System.currentTimeMillis(); }
        }, waitMs);
    }

    /** Answers at once, with no wait: for a screen deciding what to draw first. */
    public static Answer now(String port) {
        if (PayloadPort.named(port).ready()) return new Answer(State.READY, "");
        String failed = PayloadStart.failure();
        return failed != null ? new Answer(State.FAILED, failed) : new Answer(State.STARTING, "");
    }

    static Answer await(Signals s, long waitMs) {
        long deadline = s.now() + Math.max(0, waitMs);
        // The attach ends the wait the moment it happens. The loop's slices only let a
        // loader failure (which never attaches anything) end it early.
        while (true) {
            if (s.awaitAttach(0)) return new Answer(State.READY, "");
            String failed = s.failure();
            if (failed != null) {
                // A failure noted before this start may be stale: one more short look at the port.
                if (s.awaitAttach(250)) return new Answer(State.READY, "");
                return new Answer(State.FAILED, failed);
            }
            long left = deadline - s.now();
            if (left <= 0) return new Answer(State.STARTING, "");
            if (s.awaitAttach(Math.min(left, 500))) return new Answer(State.READY, "");
        }
    }

    static String words(State state, String reason) {
        switch (state) {
            case READY: return "";
            case FAILED: return FAILED_WORDS;
            default: return STARTING;
        }
    }
}
