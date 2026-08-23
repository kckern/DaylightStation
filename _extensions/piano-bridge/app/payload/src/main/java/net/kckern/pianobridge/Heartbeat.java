package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Timer;
import java.util.TimerTask;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Heartbeat — the tablet's outbound pulse. The ONE thing the bridge does unprompted.
 *
 * Before 2026-08-23 every signal from the tablet was PULL: pbctl polled :8770, the
 * kiosk page beat INTO the APK, the backend asked when it wanted to know. Nothing
 * ever left the device on its own. For a tablet at sea that is a blind spot with no
 * floor: a lost Wi-Fi association, a dead shell after a reboot, a dropped BLE link
 * all look exactly like "fine" until somebody asks — and nobody is there to ask.
 *
 * So every {@code heartbeatIntervalMs} the payload POSTs a compact status to two
 * sinks, independently (one failing must not starve the other):
 *
 *  1. The log store (VictoriaLogs jsonline insert). Indexed and queryable, which is
 *     the point: ABSENCE becomes a one-line LogsQL question —
 *       {@code context.app:piano-bridge AND _msg:bridge.heartbeat AND _time:5m}
 *     returning zero rows is the alarm. The backend never has to remember anything.
 *  2. The DaylightStation backend's device-presence endpoint, so the existing
 *     {@code lastSeenAt} / offline machinery sees this device like any other.
 *
 * Fire-and-forget with short timeouts. Never throws into the timer. Failures are
 * counted and surfaced in the NEXT beat's body (and in /diagnostics) rather than
 * logged per-tick — a sink that is down for an hour must not flood the ring buffer.
 *
 * Everything here is payload-side, so the interval, the sinks, and the body can all
 * change by payload drop. Nothing about it is frozen in the shell.
 */
public final class Heartbeat {

    private static final String TAG = "PianoBridge-Beat";
    private static final int CONNECT_TIMEOUT_MS = 4000;
    private static final int READ_TIMEOUT_MS = 6000;

    private final BridgeCore core;
    private volatile DeviceConfig cfg;
    private Timer timer;

    private final AtomicLong seq = new AtomicLong();
    private final AtomicLong lastOkAtMs = new AtomicLong();
    private final AtomicInteger logStoreFailures = new AtomicInteger();
    private final AtomicInteger backendFailures = new AtomicInteger();
    private volatile String lastError;

    public Heartbeat(BridgeCore core, DeviceConfig cfg) {
        this.core = core;
        this.cfg = cfg;
    }

    public void updateConfig(DeviceConfig c) { this.cfg = c; }

    public synchronized void start() {
        if (timer != null) return;
        if (!cfg.heartbeatEnabled()) { Log.i(TAG, "heartbeat disabled"); return; }
        long every = Math.max(10_000L, cfg.heartbeatIntervalMs());
        timer = new Timer("PianoBridge-beat", true);
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() {
                try { beat(); } catch (Throwable t) { Log.w(TAG, "beat crashed", t); }
            }
        }, 5_000L, every);
        Log.i(TAG, "heartbeat every " + every + "ms -> " + cfg.heartbeatLogStoreUrl() + " + " + cfg.heartbeatBackendUrl());
    }

    public synchronized void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
    }

    /** Build and send one beat now (also used by the control plane's POST /beat). */
    public JSONObject beat() {
        // Fire a loopback probe FIRST so this beat carries a fresh OUT verdict — the
        // piano's own echo, not an upstream counter. ~1.5s window; the body is built
        // after so outVerified reflects this probe, not the last one.
        Loopback lb = core.getLoopback();
        if (lb != null) { try { lb.probeAndWait(); } catch (Throwable t) { Log.w(TAG, "loopback probe failed", t); } }
        JSONObject body = buildBody();
        DeviceConfig c = cfg;
        boolean okLog = false, okBackend = false;
        String url = c.heartbeatLogStoreUrl();
        if (url != null && !url.isEmpty()) {
            okLog = post(url, toLogStoreLine(body), "application/stream+json");
            if (!okLog) logStoreFailures.incrementAndGet();
        }
        url = c.heartbeatBackendUrl();
        if (url != null && !url.isEmpty()) {
            okBackend = post(url, body.toString(), "application/json");
            if (!okBackend) backendFailures.incrementAndGet();
        }
        if (okLog || okBackend) lastOkAtMs.set(System.currentTimeMillis());
        return body;
    }

    /** Compact status: enough to answer "is it alive and working?" — not a full diag dump. */
    JSONObject buildBody() {
        JSONObject o = new JSONObject();
        try {
            DeviceConfig c = cfg;
            o.put("deviceId", c.heartbeatDeviceId());
            o.put("seq", seq.incrementAndGet());
            o.put("epochMs", System.currentTimeMillis());
            o.put("uptimeMs", android.os.SystemClock.elapsedRealtime());
            o.put("shellVersionCode", core.getShell().shellVersionCode());
            try {
                JSONObject p = new JSONObject(core.getShell().payloadStatusJson());
                o.put("payload", p.optString("activeVersion", null));
                o.put("payloadJar", p.optString("active", null));
            } catch (Exception ignored) { }

            BleMidiConnector ble = core.getBleConnector();
            JSONObject b = ble == null ? null : ble.status();
            o.put("ble", b == null ? "none" : b.optString("state", "?"));
            o.put("bleUptimeS", b == null ? 0 : b.optLong("connectedSeconds", 0));
            o.put("bleReconnects", b == null ? 0 : b.optInt("reconnects", 0));
            o.put("midiWriteOpen", core.isMidiWriteOpen());
            o.put("midiInOpen", core.isMidiPortOpen());
            o.put("a11yBound", A11y.isConnected());
            Loopback lb2 = core.getLoopback();
            if (lb2 != null) {
                JSONObject l = lb2.snapshot();
                o.put("outVerified", l.optBoolean("outVerified"));     // THE field: piano echoed our last probe
                o.put("loopRttMs", l.optLong("lastRttMs", -1));
                o.put("loopMisses", l.optInt("consecutiveMisses"));
            }
            o.put("fkbReachable", FkbRest.reachable(c));

            KioskWatchdog wd = core.getKioskWatchdog();
            if (wd != null) {
                JSONObject s = wd.snapshot();
                o.put("kiosk", s.optString("verdict", "?"));
                o.put("fps", s.optInt("lastFps", -1));
                o.put("beatAgoMs", s.optLong("lastBeatAgoMs", -1));
            }
            KioskSettingsGuard g = core.getKioskSettingsGuard();
            if (g != null) o.put("guard", g.snapshot().optString("verdict", "?"));

            A2dpConnector spk = core.getA2dpConnector();
            if (spk != null) o.put("speaker", spk.status().optBoolean("connected", false));

            o.put("beatFailures", new JSONObject()
                    .put("logStore", logStoreFailures.get())
                    .put("backend", backendFailures.get()));
            if (lastError != null) o.put("lastBeatError", lastError);
        } catch (Exception e) {
            try { o.put("buildError", e.getMessage()); } catch (Exception ignored) { }
        }
        return o;
    }

    /**
     * The log-store line: the beat body nested under data.*, plus the context.* /
     * level / _msg envelope the rest of DaylightStation's events use, so the same
     * LogsQL filters work ({@code context.app:piano-bridge}, {@code data.ble:CONNECTED}).
     */
    static String toLogStoreLine(JSONObject body) {
        try {
            JSONObject line = new JSONObject();
            line.put("_msg", "bridge.heartbeat");
            line.put("_time", iso(System.currentTimeMillis()));
            line.put("level", "info");
            line.put("context.source", "piano-bridge");
            line.put("context.app", "piano-bridge");
            line.put("context.device", body.optString("deviceId", "piano-tablet"));
            java.util.Iterator<String> it = body.keys();
            while (it.hasNext()) {
                String k = it.next();
                Object v = body.get(k);
                if (v instanceof JSONObject) {
                    JSONObject sub = (JSONObject) v;
                    java.util.Iterator<String> jt = sub.keys();
                    while (jt.hasNext()) { String kk = jt.next(); line.put("data." + k + "." + kk, sub.get(kk)); }
                } else {
                    line.put("data." + k, v);
                }
            }
            return line.toString() + "\n";
        } catch (Exception e) {
            return "{\"_msg\":\"bridge.heartbeat\",\"level\":\"error\",\"data.buildError\":\"" + e.getMessage() + "\"}\n";
        }
    }

    static String iso(long epochMs) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(epochMs));
    }

    private boolean post(String url, String body, String contentType) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", contentType);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            int code = c.getResponseCode();
            boolean ok = code >= 200 && code < 300;
            if (!ok) lastError = url + " -> HTTP " + code;
            return ok;
        } catch (Exception e) {
            lastError = url + " -> " + e.getClass().getSimpleName() + ": " + e.getMessage();
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    public JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", cfg.heartbeatEnabled());
            o.put("intervalMs", cfg.heartbeatIntervalMs());
            o.put("seq", seq.get());
            o.put("lastOkAtMs", lastOkAtMs.get());
            o.put("lastOkAgoMs", lastOkAtMs.get() == 0 ? -1 : System.currentTimeMillis() - lastOkAtMs.get());
            o.put("failures", new JSONObject().put("logStore", logStoreFailures.get()).put("backend", backendFailures.get()));
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
            o.put("logStoreUrl", cfg.heartbeatLogStoreUrl());
            o.put("backendUrl", cfg.heartbeatBackendUrl());
        } catch (Exception ignored) { }
        return o;
    }
}
