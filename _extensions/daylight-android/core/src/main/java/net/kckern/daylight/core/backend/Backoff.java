package net.kckern.daylight.core.backend;

public final class Backoff {
    private Backoff() { }

    /** base, 2*base, 4*base ... capped. attempt counts from 1. */
    public static long delayMs(int attempt, long baseMs, long capMs) {
        int doublings = Math.min(Math.max(attempt, 1) - 1, 30);
        long delay = baseMs << doublings;
        return delay <= 0 || delay > capMs ? capMs : delay;
    }
}
