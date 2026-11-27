package net.kckern.daylight.shellkit;

/**
 * The order of a stall's remedy for one item, driven once a second with a clock the caller
 * owns (so tests use a fake one). {@code begin} arms it; then {@code step} says what to do now:
 * STOP the transfer, RESUME it once the manager reports it stopped (or 2 s pass, so the two
 * commands never run back to back and cannot cancel each other), and, if 20 s after the resume
 * there are still no bytes, READD (remove and add the request again: the strong step, once).
 * Bytes coming at any point end the episode. Pure.
 */
public final class StallRemedy {
    public enum Step { NONE, STOP, RESUME, READD }

    public static final long STOP_WAIT_MS = 2_000;
    public static final long READD_AFTER_MS = 20_000;

    private enum State { IDLE, ARMED, STOPPING, RESUMED, READDED }

    private State state = State.IDLE;
    private long since;

    /** A stall was seen (or Retry was tapped): the next {@link #step} stops the transfer. No effect while an episode runs. */
    public void begin(long nowMs) {
        if (state == State.IDLE) { state = State.ARMED; since = nowMs; }
    }

    public boolean active() { return state != State.IDLE; }

    /**
     * @param stopped every download of the item is reported STOPPED by the manager
     * @param moving  new bytes have come: the episode is over
     */
    public Step step(long nowMs, boolean stopped, boolean moving) {
        if (moving) { state = State.IDLE; return Step.NONE; }
        switch (state) {
            case ARMED:
                state = State.STOPPING;
                since = nowMs;
                return Step.STOP;
            case STOPPING:
                if (stopped || nowMs - since >= STOP_WAIT_MS) { state = State.RESUMED; since = nowMs; return Step.RESUME; }
                return Step.NONE;
            case RESUMED:
                if (nowMs - since >= READD_AFTER_MS) { state = State.READDED; return Step.READD; }
                return Step.NONE;
            default:
                return Step.NONE;
        }
    }
}
