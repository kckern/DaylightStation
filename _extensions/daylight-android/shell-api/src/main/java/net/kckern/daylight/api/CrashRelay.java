package net.kckern.daylight.api;

import java.util.concurrent.atomic.AtomicReference;

/**
 * The process's one uncaught-exception handler, owned by the shell's class loader.
 *
 * A payload used to chain its own handler on every start. Each hot swap added a
 * handler that held the previous payload's class loader, and none was ever removed.
 * Here the handler is installed once per process and forwards to the sink of the
 * payload that is running. A payload sets its sink on start and clears it on stop,
 * after which nothing here refers to that payload's classes.
 */
public final class CrashRelay {
    /** Where a payload records a crash before the system handler runs. */
    public interface Sink { void uncaught(Thread thread, Throwable error); }

    private static final AtomicReference<Sink> SINK = new AtomicReference<>();
    private static boolean installed;
    private static Thread.UncaughtExceptionHandler previous;

    private CrashRelay() { }

    /** Make this the current payload's sink, installing the process handler on first use. */
    public static synchronized void set(Sink sink) {
        if (!installed) {
            previous = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler(CrashRelay::dispatch);
            installed = true;
        }
        SINK.set(sink);
    }

    /** Drop a sink. A no-op when a newer payload has already replaced it. */
    public static void clear(Sink sink) { SINK.compareAndSet(sink, null); }

    public static Sink current() { return SINK.get(); }

    private static void dispatch(Thread thread, Throwable error) {
        Sink sink = SINK.get();
        if (sink != null) {
            try { sink.uncaught(thread, error); } catch (Throwable ignored) { }
        }
        Thread.UncaughtExceptionHandler prev;
        synchronized (CrashRelay.class) { prev = previous; }
        // Keep the system's dialog and kill.
        if (prev != null) prev.uncaughtException(thread, error);
    }

    /** Test seam: forget the installed handler so a test can start from a known default handler. */
    static synchronized void resetForTest() {
        installed = false;
        previous = null;
        SINK.set(null);
    }
}
