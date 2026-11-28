package net.kckern.daylight.shellkit;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * How many sends in a row left batches on the phone, kept in a one-line file beside the
 * batches so a killed or restarted process does not forget it (and ask the server again at
 * the shortest wait). {@link TelemetrySchedule#retryMs} turns the count into a wait. A run
 * that left nothing removes the file. A missing, torn or negative file reads as zero.
 * Plain java.io, so it runs in JVM tests. Thread-safe.
 */
public final class TelemetryBackoff {
    /** Past this the wait is at its cap (TelemetrySchedule), so the count stops. */
    static final int MAX_RUNS = 16;

    private final File file;
    private int failedRuns;

    public TelemetryBackoff(File file) {
        this.file = file;
        failedRuns = read();
    }

    public synchronized int failedRuns() { return failedRuns; }

    /** A run finished: it {@code left} batches (one more failure) or sent them all (reset). Answers the new count. */
    public synchronized int ran(boolean left) {
        failedRuns = left ? Math.min(MAX_RUNS, failedRuns + 1) : 0;
        try {
            if (failedRuns == 0) //noinspection ResultOfMethodCallIgnored
                file.delete();
            else Files.write(file.toPath(), String.valueOf(failedRuns).getBytes(StandardCharsets.UTF_8));
        } catch (Exception unwritable) {
            // Kept in memory for this process; a restart starts the wait over.
        }
        return failedRuns;
    }

    private int read() {
        try {
            if (!file.isFile()) return 0;
            int n = Integer.parseInt(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).trim());
            return Math.max(0, Math.min(MAX_RUNS, n));
        } catch (Exception torn) {
            return 0;
        }
    }
}
