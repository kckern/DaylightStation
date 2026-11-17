package net.kckern.daylight.core;

import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * LogEvents — one-off events straight to the log store, beside the heartbeat.
 *
 * The heartbeat is a minute-by-minute summary; some things must land the moment they
 * happen (FKB losing the screen). Same jsonline endpoint and the same envelope as
 * {@link Heartbeat#toLogStoreLine}, so {@code context.app:piano-bridge} finds both.
 * Posts on one background thread; a failed post is logged and dropped, never retried.
 *
 * The thread belongs to the payload that is running. It is created at the first
 * event and ended when that payload stops: a thread left behind would keep the old
 * payload's classes loaded after every swap. Its queue is bounded. When the log
 * store is slow or gone, the oldest waiting event is dropped to make room and
 * counted, and the heartbeat reports the count.
 */
public final class LogEvents {

    private static final String TAG = "PianoBridge-Events";
    /** Events that may wait for the posting thread. */
    static final int MAX_QUEUED = 200;

    /** Sends one line. A seam: tests replace the HTTP post. */
    interface Poster { void post(String url, String line); }
    static volatile Poster poster = LogEvents::post;

    private static final Object LOCK = new Object();
    /** Null until the first event, and again after shutdown. Guarded by LOCK. */
    private static ThreadPoolExecutor pool;
    private static final AtomicLong DROPPED = new AtomicLong();

    private LogEvents() { }

    private static volatile CoreConfig cfg;

    /** Called once by core when a payload starts. */
    static void configure(CoreConfig config) { cfg = config; }

    /**
     * Called by the runtime that configured this, when it stops. Ends the posting
     * thread and drops what was waiting. A runtime that is not the current one changes
     * nothing, so an old payload stopping late cannot silence a new one.
     */
    static void shutdown(CoreConfig owner) {
        synchronized (LOCK) {
            if (cfg != owner) return;
            cfg = null;
            if (pool != null) { pool.shutdownNow(); pool = null; }
        }
    }

    /** Events dropped because the queue was full, since the process started. */
    public static long dropped() { return DROPPED.get(); }

    private static ThreadPoolExecutor newPool() {
        return new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(MAX_QUEUED), r -> {
            Thread t = new Thread(r, "PianoBridge-events");
            t.setDaemon(true);
            return t;
        }, (task, executor) -> {
            // Full: the oldest waiting event makes room for the newest.
            if (executor.isShutdown()) return;
            if (executor.getQueue().poll() != null) DROPPED.incrementAndGet();
            executor.execute(task);
        });
    }

    /** The context.app of every line this device ships. */
    public static String app() {
        CoreConfig c = cfg;
        return c == null ? "daylight" : c.logStoreApp();
    }

    public static void emit(String msg, String level, JSONObject data) {
        CoreConfig c = cfg;
        if (c == null) return;
        final String url = c.heartbeatLogStoreUrl();
        if (url == null || url.isEmpty()) return;
        final String line = Heartbeat.toLogStoreLine(msg, level, c.heartbeatDeviceId(), data);
        Log.i(TAG, msg + " " + data);
        ThreadPoolExecutor p;
        synchronized (LOCK) {
            if (cfg != c) return;      // stopped between the read above and here
            if (pool == null) pool = newPool();
            p = pool;
        }
        final Poster send = poster;
        try { p.execute(() -> send.post(url, line)); } catch (RejectedExecutionException shutDown) { }
    }

    private static void post(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(4000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/stream+json");
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            if (code >= 300) Log.w(TAG, "log store -> HTTP " + code);
        } catch (Exception e) {
            Log.w(TAG, "log store post failed: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
