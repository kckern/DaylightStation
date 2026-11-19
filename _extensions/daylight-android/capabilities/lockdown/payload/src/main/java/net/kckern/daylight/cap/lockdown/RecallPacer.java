package net.kckern.daylight.cap.lockdown;

import java.util.ArrayDeque;

/**
 * How often the watcher may recall. Pure Java; the clock is passed in.
 *
 * A recall that works is followed by a tick with nothing to recall, and the pacer is
 * reset. A recall that cannot succeed (accessibility unbound and Android refusing a
 * background start, or another app that takes the front straight back) used to be
 * repeated every second for as long as it lasted. Here the first few are immediate,
 * after that the gap doubles up to a ceiling, and no minute holds more than a fixed
 * number, whatever the gaps allowed.
 */
final class RecallPacer {
    /** Recalls in a row that go out with no added delay. */
    static final int FREE = 3;
    static final long FIRST_GAP_MS = 2_000L;
    static final long MAX_GAP_MS = 30_000L;
    static final int MAX_PER_MINUTE = 12;
    private static final long MINUTE_MS = 60_000L;

    private int consecutive;
    private long lastAtMs;
    private final ArrayDeque<Long> recent = new ArrayDeque<>();

    /** The gap required before recall number {@code next} (1-based) of an unbroken run. */
    static long gapBefore(int next) {
        if (next <= FREE) return 0;
        long gap = FIRST_GAP_MS << Math.min(next - FREE - 1, 10);
        return Math.min(gap, MAX_GAP_MS);
    }

    /** The watcher wants to recall. True when it may now; the recall is then counted. */
    synchronized boolean due(long nowMs) {
        while (!recent.isEmpty() && nowMs - recent.peekFirst() >= MINUTE_MS) recent.removeFirst();
        if (recent.size() >= MAX_PER_MINUTE) return false;
        if (consecutive > 0 && nowMs - lastAtMs < gapBefore(consecutive + 1)) return false;
        consecutive++;
        lastAtMs = nowMs;
        recent.addLast(nowMs);
        return true;
    }

    /** A tick found nothing to recall: the run is over. The per-minute count is kept. */
    synchronized void settled() { consecutive = 0; }

    /** How many recalls this unbroken run has made. */
    synchronized int consecutive() { return consecutive; }
}
