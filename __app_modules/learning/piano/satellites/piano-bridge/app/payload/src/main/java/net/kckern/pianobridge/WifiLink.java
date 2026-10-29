package net.kckern.pianobridge;

import android.content.Context;
import android.net.TrafficStats;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * WifiLink — the tablet's Wi-Fi link, sampled every {@code wifiSampleIntervalMs}
 * (default 10 s) and written to the log store, so "was the tablet's link the problem?"
 * has an answer after the fact. Added in p34 after the 2026-10-28 lesson-video stalls,
 * where delivery to the tablet collapsed and nothing recorded why.
 *
 * Each tick reads WifiManager.getConnectionInfo() (rssi, link rates, frequency, BSSID —
 * the SSID is deliberately never read, since the network name identifies the
 * household). Android 10 redacts the BSSID while Location services are off, so since
 * p35 the BSSID falls back to Fully Kiosk's deviceInfo (cached, refreshed at most
 * every 30 s on this timer, never on the HTTP thread); {@code bssidSource} says which.
 * plus TrafficStats total byte counters for real throughput, then:
 *  - posts {@code bridge.wifi} (level warn when degraded) — same envelope and sink as
 *    the heartbeat, so {@code context.app:piano-bridge} finds it;
 *  - posts {@code bridge.wifi.roam} first when the BSSID changed;
 *  - keeps the last 60 samples for {@code GET /wifi}, which the kiosk Player asks on a stall.
 *
 * A sample taken while the link is down cannot be sent, which is exactly when it
 * matters. So unsent lines wait in a bounded backlog (stamped with the time they were
 * measured) and go out with the next successful post. Failures are counted, never
 * logged per tick. Nothing here throws into the timer.
 *
 * The rules (rates, band, roam, degraded) are pure and live in {@link WifiLinkPolicy}.
 */
public final class WifiLink {

    private static final String TAG = "PianoBridge-Wifi";
    static final int RING = 60;
    /** 30 min of 10 s samples. Older unsent lines are dropped first. */
    static final int MAX_BACKLOG = 180;
    private static final int CONNECT_TIMEOUT_MS = 3000;
    private static final int READ_TIMEOUT_MS = 4000;
    /** FKB deviceInfo (BSSID fallback) at most this often, and trusted this long. */
    static final long FKB_REFRESH_MS = 30_000L;
    static final long FKB_MAX_AGE_MS = 90_000L;

    private final BridgeCore core;
    private volatile DeviceConfig cfg;
    private Timer timer;
    private long runningEveryMs;

    private final WifiLinkPolicy.Tracker tracker = new WifiLinkPolicy.Tracker(RING);
    private final WifiLinkPolicy.Backlog backlog = new WifiLinkPolicy.Backlog(MAX_BACKLOG);
    private final AtomicInteger logStoreFailures = new AtomicInteger();
    private final AtomicInteger roams = new AtomicInteger();
    private final AtomicLong lastOkAtMs = new AtomicLong();
    private volatile String lastError;
    // BSSID fallback cache. Written only on the timer thread; read anywhere.
    private volatile String fkbBssid;
    private volatile long fkbFetchedAtMs;
    private volatile long fkbAttemptAtMs;
    private final AtomicInteger fkbFailures = new AtomicInteger();

    public WifiLink(BridgeCore core, DeviceConfig cfg) {
        this.core = core;
        this.cfg = cfg;
    }

    private static long everyMs(DeviceConfig c) { return Math.max(2_000L, c.wifiSampleIntervalMs()); }

    public synchronized void start() {
        if (timer != null) return;
        if (!cfg.wifiTelemetryEnabled()) { Log.i(TAG, "wifi telemetry disabled"); return; }
        long every = everyMs(cfg);
        runningEveryMs = every;
        timer = new Timer("PianoBridge-wifi", true);
        // Fixed DELAY, not rate: a post can block up to ~7 s on a bad link, and
        // catch-up bursts would only pile more traffic onto it.
        timer.schedule(new TimerTask() {
            @Override public void run() {
                try { tick(); } catch (Throwable t) { lastError = "tick: " + t; }
            }
        }, 3_000L, every);
        Log.i(TAG, "wifi telemetry every " + every + "ms");
    }

    public synchronized void stop() {
        if (timer != null) { timer.cancel(); timer = null; }
    }

    /** Swap config; restart the timer only if enabled/interval changed (keeps the ring). */
    public synchronized void updateConfig(DeviceConfig c) {
        this.cfg = c;
        boolean running = timer != null;
        if (!c.wifiTelemetryEnabled()) { if (running) stop(); return; }
        if (!running || runningEveryMs != everyMs(c)) { stop(); start(); }
    }

    private WifiLinkPolicy.Thresholds thresholds() {
        DeviceConfig c = cfg;
        return new WifiLinkPolicy.Thresholds(c.wifiDegradedRssiDbm(), c.wifiDegradedLinkMbps());
    }

    /** Read + record one sample and queue its log lines. Does not post. */
    WifiLinkPolicy.Sample sample() {
        WifiLinkPolicy.Sample s = tracker.add(read(), thresholds());
        String dev = cfg.heartbeatDeviceId();
        if (s.roamed) {
            roams.incrementAndGet();
            JSONObject roam = new JSONObject();
            try {
                roam.put("from", s.roamFrom);
                roam.put("to", s.bssid);
                roam.put("fromFreqMhz", s.roamFromFreqMhz);
                roam.put("toFreqMhz", s.freqMhz);
                roam.put("fromBand", WifiLinkPolicy.band(s.roamFromFreqMhz));
                roam.put("toBand", s.band);
                roam.put("fromRssi", s.roamFromRssi);
                roam.put("toRssi", s.rssi);
                roam.put("roams", roams.get());
            } catch (Exception ignored) { }
            enqueue(Heartbeat.toLogStoreLine("bridge.wifi.roam", "info", dev, roam, s.epochMs));
            Log.i(TAG, "roam " + s.roamFrom + " -> " + s.bssid);
        }
        JSONObject body = s.toJson();
        try {
            body.put("intervalMs", runningEveryMs);
            body.put("backlog", backlogSize());
            body.put("failures", logStoreFailures.get());
        } catch (Exception ignored) { }
        enqueue(Heartbeat.toLogStoreLine("bridge.wifi", s.degraded ? "warn" : "info", dev, body, s.epochMs));
        return s;
    }

    private void tick() {
        refreshFkbBssid();
        sample();
        flush();
    }

    /**
     * Refresh FKB's BSSID if Android is redacting ours. Timer thread only, rate-limited
     * to one deviceInfo per 30 s (FkbRest's 2.5 s / 4 s timeouts). The HTTP thread
     * (/wifi?fresh=1) only ever reads the cache.
     */
    private void refreshFkbBssid() {
        if (lastWifiManagerBssidPresent) return;   // nothing to fill in
        long now = System.currentTimeMillis();
        if (!WifiLinkPolicy.fkbRefreshDue(now, fkbAttemptAtMs, FKB_REFRESH_MS)) return;
        fkbAttemptAtMs = now;
        try {
            JSONObject info = FkbRest.deviceInfo(cfg);
            String b = info.optBoolean("authOk", false) ? info.optString("bssid", null) : null;
            if (WifiLinkPolicy.normalizeBssid(b) != null) {
                fkbBssid = b;
                fkbFetchedAtMs = now;
            } else {
                fkbFailures.incrementAndGet();
            }
        } catch (Throwable t) {
            fkbFailures.incrementAndGet();
        }
    }

    private volatile boolean lastWifiManagerBssidPresent;

    private WifiLinkPolicy.Reading read() {
        WifiLinkPolicy.Reading r = new WifiLinkPolicy.Reading();
        r.epochMs = System.currentTimeMillis();
        r.elapsedMs = SystemClock.elapsedRealtime();
        try {
            Context cx = core.getContext().getApplicationContext();
            WifiManager wm = (WifiManager) cx.getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = wm == null ? null : wm.getConnectionInfo();
            if (info != null) {
                r.connected = info.getSupplicantState() == SupplicantState.COMPLETED;
                r.rssi = info.getRssi();
                r.linkSpeedMbps = info.getLinkSpeed();
                r.rxLinkSpeedMbps = info.getRxLinkSpeedMbps();   // API 29+ (minSdk 29)
                r.txLinkSpeedMbps = info.getTxLinkSpeedMbps();
                r.freqMhz = info.getFrequency();
                r.bssid = info.getBSSID();
            }
        } catch (Throwable t) {
            lastError = "read: " + t;
        }
        lastWifiManagerBssidPresent = WifiLinkPolicy.normalizeBssid(r.bssid) != null;
        if (WifiLinkPolicy.fkbFresh(r.epochMs, fkbFetchedAtMs, FKB_MAX_AGE_MS)) r.fkbBssid = fkbBssid;
        try {
            r.rxBytes = TrafficStats.getTotalRxBytes();
            r.txBytes = TrafficStats.getTotalTxBytes();
        } catch (Throwable ignored) { }
        return r;
    }

    private void enqueue(String line) { backlog.add(line); }

    private int backlogSize() { return backlog.size(); }

    /** Post every queued line in one jsonline request; keep them on failure. */
    private void flush() {
        String url = cfg.heartbeatLogStoreUrl();
        if (url == null || url.isEmpty()) { backlog.clear(); return; }
        WifiLinkPolicy.Backlog.Batch batch = backlog.snapshot();
        if (batch == null) return;
        if (post(url, batch.body)) {
            backlog.ack(batch);   // by id: lines added/evicted mid-post are safe
            lastOkAtMs.set(System.currentTimeMillis());
        } else {
            logStoreFailures.incrementAndGet();
        }
    }

    private boolean post(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/stream+json");
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            int code = c.getResponseCode();
            boolean ok = code >= 200 && code < 300;
            if (!ok) lastError = "log store -> HTTP " + code;
            return ok;
        } catch (Exception e) {
            lastError = "log store -> " + e.getClass().getSimpleName() + ": " + e.getMessage();
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Heartbeat's compact `wifi` object from the latest sample, or null before the first. */
    public JSONObject compact() {
        WifiLinkPolicy.Sample s = tracker.latest();
        if (s == null) return null;
        JSONObject o = s.toCompactJson();
        try { o.put("ageMs", System.currentTimeMillis() - s.epochMs); } catch (Exception ignored) { }
        return o;
    }

    /**
     * GET /wifi. {@code fresh} takes a sample now (queued for the next post) so a
     * caller reacting to a stall sees the link as it is, not up to one interval ago.
     */
    public JSONObject snapshot(boolean fresh) {
        if (fresh) { try { sample(); } catch (Throwable t) { lastError = "fresh: " + t; } }
        JSONObject o = new JSONObject();
        try {
            WifiLinkPolicy.Sample s = tracker.latest();
            o.put("ok", true);
            o.put("current", s == null ? JSONObject.NULL : s.toJson().put("ageMs", System.currentTimeMillis() - s.epochMs));
            o.put("recent", tracker.recentJson());
            o.put("enabled", cfg.wifiTelemetryEnabled());
            o.put("running", timer != null);
            o.put("intervalMs", runningEveryMs);
            o.put("thresholds", thresholds().toJson());
            o.put("roams", roams.get());
            o.put("backlog", backlogSize());
            o.put("dropped", backlog.dropped());
            o.put("failures", new JSONObject().put("logStore", logStoreFailures.get()).put("fkbBssid", fkbFailures.get()));
            o.put("fkbBssidAgeMs", fkbFetchedAtMs == 0 ? -1 : System.currentTimeMillis() - fkbFetchedAtMs);
            o.put("lastOkAgoMs", lastOkAtMs.get() == 0 ? -1 : System.currentTimeMillis() - lastOkAtMs.get());
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
        } catch (Exception ignored) { }
        return o;
    }
}
