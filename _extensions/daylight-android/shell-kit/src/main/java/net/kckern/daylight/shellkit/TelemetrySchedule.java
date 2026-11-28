package net.kckern.daylight.shellkit;

/**
 * When the phone's held telemetry needs the background job (TelemetryJob), and how long
 * the job waits before trying again. Pure, for JVM tests.
 *
 * <p>The job is for batches held with no screen open: while one is shown, its own 30 s
 * timer sends. A run that left batches asks again after 30 s, doubling, but never more
 * than 15 min apart (the inbox job's period, which sends too), so a phone that was
 * offline for an hour does not then wait hours more.
 */
public final class TelemetrySchedule {
    static final long FIRST_RETRY_MS = 30_000L, MAX_RETRY_MS = 15 * 60_000L;

    private TelemetrySchedule() { }

    /** Batches held and no screen open to send them: schedule the job. */
    public static boolean needsJob(int heldBatches, boolean screenOpen) {
        return heldBatches > 0 && !screenOpen;
    }

    /** The wait before the next try, after {@code failedRuns} runs that left batches. */
    public static long retryMs(int failedRuns) {
        long ms = FIRST_RETRY_MS;
        for (int i = 0; i < failedRuns && ms < MAX_RETRY_MS; i++) ms *= 2;
        return Math.min(ms, MAX_RETRY_MS);
    }

    /** After a network returns with batches held and no screen: the job runs within seconds. */
    public static final long NETWORK_BACK_MS = 2_000L;

    /** Failed runs after which {@link #retryMs} stops growing (the count need not go higher). */
    public static int runsToCap() {
        int n = 0;
        while (retryMs(n) < MAX_RETRY_MS) n++;
        return n;
    }

    /**
     * Whether a failed send adds to the count that lengthens the job's wait: only a run that
     * could have succeeded (the job, which holds the shell and waits for its payload) with no
     * screen open. A screen's own timer retries on its own backoff, and a flush with no payload
     * fails by design.
     */
    public static boolean countsFailure(boolean screenOpen, boolean ranWithPayloadHeld) {
        return !screenOpen && ranWithPayloadHeld;
    }

    /**
     * Whether scheduling the job again should replace the one already waiting (which restarts
     * its clock): when none waits ({@code pendingWaitMs < 0}), when the job itself is
     * rescheduling after its run, or when the new wait is shorter. A flush that could not
     * succeed, with a job already waiting, leaves it alone.
     */
    public static boolean replacePending(long pendingWaitMs, long newWaitMs, boolean afterJobRun) {
        return pendingWaitMs < 0 || afterJobRun || newWaitMs < pendingWaitMs;
    }
}
