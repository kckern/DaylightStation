package net.kckern.daylight.api;

/**
 * How the payload's start is going, as the shell's loader saw it, for an installed screen
 * that waits for a payload (see PayloadPort). The loader writes it; screens only read it.
 * Nothing crosses a process: it is this process's own loader.
 *
 * A screen waiting on a port uses this to tell "still starting" from "could not start":
 * a payload that failed to start (and found no fallback) will never attach, so the wait
 * ends with the loader's own reason instead of running out.
 */
public final class PayloadStart {
    /**
     * How long the loader gives one payload's start() (PayloadLoader's deadline). A screen
     * that waits for a payload waits at least this long, plus the time to read the jar.
     */
    public static final long START_DEADLINE_MS = 20_000L;

    /** How long a screen waits for a payload to attach before it says "still starting". */
    public static final long WAIT_MS = START_DEADLINE_MS + 5_000L;

    private static volatile String failure;
    private static volatile long failedAt;

    private PayloadStart() { }

    /** The loader is starting a payload: a failure seen before is no longer the answer. */
    public static void starting() { failure = null; }

    /** A payload started. */
    public static void started() { failure = null; }

    /** No payload could be started: {@code reason} is the loader's last error. */
    public static void failed(String reason) {
        failedAt = System.currentTimeMillis();
        failure = reason == null || reason.isEmpty() ? "the payload did not start" : reason;
    }

    /** The loader's reason when no payload could be started, or null while one starts or runs. */
    public static String failure() { return failure; }

    /** When the last failure was noted (wall clock), or 0. */
    public static long failedAt() { return failure == null ? 0 : failedAt; }
}
