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
import java.util.ArrayDeque;
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
 * Each tick reads WifiManager.getConnectionInfo() (rssi, link rates, frequency, BSSID,
 * SSID — ACCESS_FINE_LOCATION is granted, and the redacted placeholders are tolerated)
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

    private final BridgeCore core;
    private volatile DeviceConfig cfg;
    private Timer timer;
    private long runningEveryMs;

    private final WifiLinkPolicy.Tracker tracker = new WifiLinkPolicy.Tracker(RING);
    private final ArrayDeque<String> backlog = new ArrayDeque<>();
    private final AtomicInteger logStoreFailures = new AtomicInteger();
    private final AtomicInteger dropped = new AtomicInteger();
    private final AtomicInteger roams = new AtomicInteger();
    private final AtomicLong lastOkAtMs = new AtomicLong();
    private volatile String lastError;

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
        sample();
        flush();
    }

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
                r.ssid = info.getSSID();
            }
        } catch (Throwable t) {
            lastError = "read: " + t;
        }
        try {
            r.rxBytes = TrafficStats.getTotalRxBytes();
            r.txBytes = TrafficStats.getTotalTxBytes();
        } catch (Throwable ignored) { }
        return r;
    }

    private void enqueue(String line) {
        synchronized (backlog) {
            backlog.addLast(line);
            while (backlog.size() > MAX_BACKLOG) { backlog.pollFirst(); dropped.incrementAndGet(); }
        }
    }

    private int backlogSize() { synchronized (backlog) { return backlog.size(); } }

    /** Post every queued line in one jsonline request; keep them on failure. */
    private void flush() {
        String url = cfg.heartbeatLogStoreUrl();
        if (url == null || url.isEmpty()) { synchronized (backlog) { backlog.clear(); } return; }
        int n;
        StringBuilder sb = new StringBuilder();
        synchronized (backlog) {
            n = backlog.size();
            if (n == 0) return;
            for (String l : backlog) sb.append(l);
        }
        if (post(url, sb.toString())) {
            synchronized (backlog) { for (int i = 0; i < n && !backlog.isEmpty(); i++) backlog.pollFirst(); }
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
            o.put("dropped", dropped.get());
            o.put("failures", new JSONObject().put("logStore", logStoreFailures.get()));
            o.put("lastOkAgoMs", lastOkAtMs.get() == 0 ? -1 : System.currentTimeMillis() - lastOkAtMs.get());
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
        } catch (Exception ignored) { }
        return o;
    }
}
