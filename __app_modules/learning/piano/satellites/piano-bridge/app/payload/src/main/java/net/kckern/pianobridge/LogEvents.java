package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LogEvents — one-off events straight to the log store, beside the heartbeat.
 *
 * The heartbeat is a minute-by-minute summary; some things must land the moment they
 * happen (FKB losing the screen). Same jsonline endpoint and the same envelope as
 * {@link Heartbeat#toLogStoreLine}, so {@code context.app:piano-bridge} finds both.
 * Posts on one background thread; a failed post is logged and dropped, never retried.
 */
final class LogEvents {

    private static final String TAG = "PianoBridge-Events";
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "PianoBridge-events");
        t.setDaemon(true);
        return t;
    });

    private LogEvents() { }

    static void emit(DeviceConfig cfg, String msg, String level, JSONObject data) {
        if (cfg == null) return;
        final String url = cfg.heartbeatLogStoreUrl();
        if (url == null || url.isEmpty()) return;
        final String line = Heartbeat.toLogStoreLine(msg, level, cfg.heartbeatDeviceId(), data);
        Log.i(TAG, msg + " " + data);
        POOL.execute(() -> post(url, line));
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
