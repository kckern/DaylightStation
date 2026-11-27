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
}
