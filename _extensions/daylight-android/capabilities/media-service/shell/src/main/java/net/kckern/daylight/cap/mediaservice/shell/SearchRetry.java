package net.kckern.daylight.cap.mediaservice.shell;

import java.util.function.LongSupplier;

/**
 * When a search that home did not answer is asked again by itself, pure and clock-injected.
 * Home not answering (a timeout, a 5xx, no route, or the port's own wait running out, whose
 * reason is empty) is retried after 5 s, three times; no validated network waits for the
 * network callback instead of a timer. A retry belongs to the text it was planned for: when
 * the text changes (or the field is cleared) it is dropped, so a stale retry never
 * overwrites a newer query's results.
 */
final class SearchRetry {
    static final long DELAY_MS = 5_000;
    static final int MAX = 3;
    static final int NONE = -1, ON_NETWORK = -2;
    /** timerFired: run the retry now / nothing to run (a stale or cancelled timer). A positive value is the wait left. */
    static final long FIRE = 0, STALE = -1;

    enum Waiting { NONE, TIMER, NETWORK }

    private final LongSupplier clock;
    private String text;
    private int tries;
    private Waiting waiting = Waiting.NONE;
    private long dueAt;

    SearchRetry(LongSupplier clock) { this.clock = clock; }

    /** A search the person asked for (typed, tapped Try again, picked a recent one): the count starts again. */
    synchronized void begin(String q) { text = q; tries = 0; waiting = Waiting.NONE; }

    /** The search is gone (the field was cleared). */
    synchronized void cancel() { text = null; tries = 0; waiting = Waiting.NONE; }

    /** An automatic retry started running; it used one of the tries. */
    synchronized void retryStarted(String q) {
        if (!q.equals(text)) return;
        waiting = Waiting.NONE;
    }

    synchronized void succeeded(String q) { if (q.equals(text)) waiting = Waiting.NONE; }

    /** What to do after a failure: a delay in ms, ON_NETWORK, or NONE. */
    synchronized int failed(String q, String reason, boolean networkValidated) {
        if (!q.equals(text)) return NONE;
        waiting = Waiting.NONE;
        if (!retryable(reason)) return NONE;
        if (!networkValidated) { waiting = Waiting.NETWORK; return ON_NETWORK; }
        if (tries >= MAX) return NONE;
        tries++;
        waiting = Waiting.TIMER;
        dueAt = clock.getAsLong() + DELAY_MS;
        return (int) DELAY_MS;
    }

    /**
     * The planned timer fired: FIRE once (only for the text it was planned for, once due), the
     * wait left when it came early (the state stays, so the caller posts it again), else STALE.
     */
    synchronized long timerFired(String q) {
        if (!q.equals(text) || waiting != Waiting.TIMER) return STALE;
        long left = dueAt - clock.getAsLong();
        if (left > 0) return left;
        waiting = Waiting.NONE;
        return FIRE;
    }

    /**
     * The network came back (see NetworkEdge): true once, only for a search waiting for it. A
     * timer wait is left alone, so a flapping connection cannot spend the tries against a down home.
     */
    synchronized boolean networkBack(String q) {
        if (!q.equals(text) || waiting != Waiting.NETWORK) return false;
        waiting = Waiting.NONE;
        return true;
    }

    synchronized Waiting waiting(String q) { return q.equals(text) ? waiting : Waiting.NONE; }

    /**
     * A deny-list, so it agrees with FailureWords.cause (anything not named here is "Home isn't
     * answering", and is asked again): what another try cannot fix is not retried.
     */
    static boolean retryable(String reason) {
        if (reason == null) return true;
        switch (reason) {
            case "refused": case "not-found": case "not_found": case "bad-request": case "bad_request":
            case "unauthorized": case "forbidden": case "starting": return false;
            default: return true;
        }
    }
}
