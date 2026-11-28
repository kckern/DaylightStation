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

    /** The planned timer fired: true once, only for the text it was planned for and not before it was due. */
    synchronized boolean timerFired(String q) {
        if (!q.equals(text) || waiting != Waiting.TIMER || clock.getAsLong() < dueAt) return false;
        waiting = Waiting.NONE;
        return true;
    }

    /** Connectivity returned: true once, when a retry was waiting (for the network or on its timer). */
    synchronized boolean networkBack(String q) {
        if (!q.equals(text) || waiting == Waiting.NONE) return false;
        waiting = Waiting.NONE;
        return true;
    }

    synchronized Waiting waiting(String q) { return q.equals(text) ? waiting : Waiting.NONE; }

    private static boolean retryable(String reason) {
        if (reason == null) return true;
        switch (reason) {
            case "timeout": case "home-error": case "unreachable": case "": return true;
            default: return false;
        }
    }
}
