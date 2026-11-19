package net.kckern.daylight.core;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/**
 * Route handlers run on HTTP threads and a payload starts on a worker thread with no
 * Looper; views, windows and the WebView may only be touched on the main thread.
 */
public final class MainThread {
    private MainThread() { }

    private static Handler handler() { return new Handler(Looper.getMainLooper()); }

    /** Test seam: android.jar's Handler does nothing on the JVM, so posted work would never run. */
    private static volatile boolean inline;
    public static void runInlineForTest(boolean on) { inline = on; }

    public static void post(Runnable r) {
        if (inline) { r.run(); return; }
        handler().post(r);
    }

    public static void postDelayed(Runnable r, long delayMs) { handler().postDelayed(r, delayMs); }

    /**
     * Run on the main thread and wait for the result. For route handlers only: never
     * call this from a capability's start(), which must not wait on the main thread.
     */
    public static <T> T call(Callable<T> work, long timeoutMs) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return work.call();
        FutureTask<T> task = new FutureTask<>(work);
        handler().post(task);
        try {
            return task.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw e;
        }
    }

    /** Poll a condition from a worker thread. */
    public static boolean waitFor(BooleanSupplier condition, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (true) {
            if (condition.getAsBoolean()) return true;
            if (System.currentTimeMillis() >= deadline) return false;
            try { Thread.sleep(50); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
        }
    }
}
