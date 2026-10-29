package net.kckern.pianobridge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Locale;

/**
 * WifiLinkPolicy — the pure half of the tablet's Wi-Fi link telemetry ({@link WifiLink}).
 *
 * Why: on 2026-10-28 lesson videos stalled on the piano tablet for seven minutes. The
 * server, Plex and the LAN all checked out; delivery to the tablet itself had collapsed
 * to 0.01–1.2 Mbps against a 2.4 Mbps file. Interference, a roam, or Bluetooth A2DP
 * sharing the 2.4 GHz radio were all plausible and none could be shown, because nothing
 * recorded the tablet's link. This turns raw WifiInfo + TrafficStats readings into the
 * fields and verdicts the log store gets asked about next time.
 *
 * No Android types here, so every rule is a plain JVM test (WifiLinkPolicyTest).
 *
 * <p><b>Degraded thresholds</b> (defaults, live-tunable via DeviceConfig):
 * <ul>
 *   <li>{@code rssi <= -75 dBm} — below that, 802.11ac on this class of radio drops
 *       to low MCS rates and retries climb; a 2.4 Mbps stream has little headroom left.</li>
 *   <li>{@code linkSpeedMbps < 20} — the negotiated PHY rate. Useful throughput is
 *       roughly half the PHY rate at best, so under 20 Mbps a 2.4 Mbps video plus
 *       retransmits and a shared channel is at real risk.</li>
 *   <li>not associated at all — {@code degradedReason:"disconnected"}.</li>
 * </ul>
 * Invalid readings (rssi -127, link speed -1) never count as degraded on their own.
 */
public final class WifiLinkPolicy {

    public static final int DEFAULT_DEGRADED_RSSI_DBM = -75;
    public static final int DEFAULT_DEGRADED_LINK_MBPS = 20;
    /** WifiInfo.INVALID_RSSI. */
    static final int INVALID_RSSI = -127;

    private WifiLinkPolicy() { }

    public static final class Thresholds {
        public final int rssiDbm;
        public final int linkMbps;
        public Thresholds(int rssiDbm, int linkMbps) { this.rssiDbm = rssiDbm; this.linkMbps = linkMbps; }
        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try { o.put("degradedRssiDbm", rssiDbm).put("degradedLinkSpeedMbps", linkMbps); } catch (Exception ignored) { }
            return o;
        }
    }

    /**
     * kbit/s from two cumulative byte counters. bytes*8/ms == kbit/s. Returns -1 —
     * "unknown", never a negative rate — when either counter is unsupported (-1), the
     * counter went backwards (interface bounce resets TrafficStats), or no time passed.
     */
    public static long kbps(long prevBytes, long curBytes, long elapsedMs) {
        if (prevBytes < 0 || curBytes < 0 || elapsedMs <= 0) return -1;
        long delta = curBytes - prevBytes;
        if (delta < 0) return -1;
        return (delta * 8L) / elapsedMs;
    }

    /** "2.4GHz" | "5GHz" | "6GHz" | "unknown" from the channel centre frequency. */
    public static String band(int freqMhz) {
        if (freqMhz >= 2400 && freqMhz < 2500) return "2.4GHz";
        if (freqMhz >= 4900 && freqMhz < 5925) return "5GHz";
        if (freqMhz >= 5925 && freqMhz <= 7125) return "6GHz";
        return "unknown";
    }

    /** Lower-cased BSSID, or null for absent / Android's redacted placeholder. */
    public static String normalizeBssid(String b) {
        if (b == null) return null;
        String s = b.trim().toLowerCase(Locale.US);
        if (s.isEmpty() || "02:00:00:00:00:00".equals(s) || "00:00:00:00:00:00".equals(s)) return null;
        return s;
    }

    /** Comma-joined reasons ("rssi", "linkSpeed", "disconnected"), or null when healthy. */
    public static String degradedReason(boolean connected, int rssi, int linkSpeedMbps, Thresholds t) {
        if (!connected) return "disconnected";
        StringBuilder sb = new StringBuilder();
        if (rssi != INVALID_RSSI && rssi < 0 && rssi <= t.rssiDbm) sb.append("rssi");
        if (linkSpeedMbps > 0 && linkSpeedMbps < t.linkMbps) { if (sb.length() > 0) sb.append(','); sb.append("linkSpeed"); }
        return sb.length() == 0 ? null : sb.toString();
    }

    /** One raw read of the platform (filled by WifiLink; by hand in tests). */
    public static final class Reading {
        public long epochMs;
        public long elapsedMs;          // SystemClock.elapsedRealtime(): monotonic, for rates
        public boolean connected;
        public int rssi = INVALID_RSSI;
        public int linkSpeedMbps = -1;
        public int rxLinkSpeedMbps = -1;
        public int txLinkSpeedMbps = -1;
        public int freqMhz = -1;
        public String bssid;            // no SSID on purpose: the network name identifies the household
        public long rxBytes = -1;       // TrafficStats.getTotalRxBytes()
        public long txBytes = -1;
    }

    /** A reading with the derived fields. Immutable once built. */
    public static final class Sample {
        public final long seq, epochMs;
        public final boolean connected;
        public final int rssi, linkSpeedMbps, rxLinkSpeedMbps, txLinkSpeedMbps, freqMhz;
        public final String band, bssid;
        public final long rxKbps, txKbps;
        public final boolean degraded;
        public final String degradedReason;
        public final boolean roamed;
        public final String roamFrom;
        public final int roamFromFreqMhz;
        public final int roamFromRssi;

        Sample(long seq, Reading r, String bssid, long rxKbps, long txKbps,
               String degradedReason, String roamFrom, int roamFromFreqMhz, int roamFromRssi) {
            this.seq = seq;
            this.epochMs = r.epochMs;
            this.connected = r.connected;
            this.rssi = r.rssi;
            this.linkSpeedMbps = r.linkSpeedMbps;
            this.rxLinkSpeedMbps = r.rxLinkSpeedMbps;
            this.txLinkSpeedMbps = r.txLinkSpeedMbps;
            this.freqMhz = r.freqMhz;
            this.band = band(r.freqMhz);
            this.bssid = bssid;
            this.rxKbps = rxKbps;
            this.txKbps = txKbps;
            this.degradedReason = degradedReason;
            this.degraded = degradedReason != null;
            this.roamFrom = roamFrom;
            this.roamed = roamFrom != null;
            this.roamFromFreqMhz = roamFromFreqMhz;
            this.roamFromRssi = roamFromRssi;
        }

        /** Full sample: the bridge.wifi event body and each /wifi entry. */
        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("seq", seq);
                o.put("epochMs", epochMs);
                o.put("connected", connected);
                o.put("rssi", rssi);
                o.put("linkSpeedMbps", linkSpeedMbps);
                o.put("rxLinkSpeedMbps", rxLinkSpeedMbps);
                o.put("txLinkSpeedMbps", txLinkSpeedMbps);
                o.put("freqMhz", freqMhz);
                o.put("band", band);
                o.put("bssid", bssid == null ? JSONObject.NULL : bssid);
                o.put("rxKbps", rxKbps);
                o.put("txKbps", txKbps);
                o.put("degraded", degraded);
                o.put("degradedReason", degradedReason == null ? "" : degradedReason);
                o.put("roamed", roamed);
                if (roamed) o.put("roamFrom", roamFrom);
            } catch (Exception ignored) { }
            return o;
        }

        /** The heartbeat's compact `wifi` object (flattened to data.wifi.* in the store). */
        public JSONObject toCompactJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("rssi", rssi);
                o.put("linkSpeedMbps", linkSpeedMbps);
                o.put("freqMhz", freqMhz);
                o.put("band", band);
                o.put("bssid", bssid == null ? JSONObject.NULL : bssid);
                o.put("rxKbps", rxKbps);
                o.put("degraded", degraded);
            } catch (Exception ignored) { }
            return o;
        }
    }

    /**
     * Stateful but pure: turns successive readings into samples (rates from the previous
     * reading, roams against the last AP we were actually on) and keeps a bounded ring.
     * Synchronized — the sampler thread writes, the HTTP thread reads.
     */
    public static final class Tracker {
        private final int capacity;
        private final ArrayDeque<Sample> ring;
        private Reading prev;
        private String lastBssid;       // last real AP, survives a disconnected gap
        private int lastFreqMhz = -1;
        private int lastRssi = INVALID_RSSI;
        private long seq;

        public Tracker(int capacity) {
            this.capacity = Math.max(1, capacity);
            this.ring = new ArrayDeque<>(this.capacity);
        }

        public synchronized Sample add(Reading r, Thresholds t) {
            long rx = -1, tx = -1;
            if (prev != null) {
                long dt = r.elapsedMs - prev.elapsedMs;
                rx = kbps(prev.rxBytes, r.rxBytes, dt);
                tx = kbps(prev.txBytes, r.txBytes, dt);
            }
            String bssid = normalizeBssid(r.bssid);
            String roamFrom = null;
            int roamFromFreq = -1, roamFromRssi = INVALID_RSSI;
            if (r.connected && bssid != null) {
                if (lastBssid != null && !lastBssid.equals(bssid)) {
                    roamFrom = lastBssid;
                    roamFromFreq = lastFreqMhz;
                    roamFromRssi = lastRssi;
                }
                lastBssid = bssid;
                lastFreqMhz = r.freqMhz;
                lastRssi = r.rssi;
            }
            Sample s = new Sample(++seq, r, bssid, rx, tx,
                    degradedReason(r.connected, r.rssi, r.linkSpeedMbps, t), roamFrom, roamFromFreq, roamFromRssi);
            prev = r;
            if (ring.size() >= capacity) ring.pollFirst();
            ring.addLast(s);
            return s;
        }

        public synchronized Sample latest() { return ring.peekLast(); }

        /** Oldest first. */
        public synchronized JSONArray recentJson() {
            JSONArray a = new JSONArray();
            for (Sample s : ring) a.put(s.toJson());
            return a;
        }
    }
    /**
     * Log lines waiting to be posted, oldest first, capped (oldest evicted first).
     * Every line gets a monotonic id; {@link #ack} removes by id, so a line evicted or
     * added while a post was in flight can never make an unsent line disappear.
     * (The first cut removed "the first n" after the post — a concurrent add at
     * capacity shifted the queue and that dropped never-sent lines.)
     */
    public static final class Backlog {
        public static final class Batch {
            public final String body;
            final long lastId;
            public final int lines;
            Batch(String body, long lastId, int lines) { this.body = body; this.lastId = lastId; this.lines = lines; }
        }

        private static final class Entry {
            final long id; final String line;
            Entry(long id, String line) { this.id = id; this.line = line; }
        }

        private final int capacity;
        private final ArrayDeque<Entry> q = new ArrayDeque<>();
        private long nextId;
        private int dropped;

        public Backlog(int capacity) { this.capacity = Math.max(1, capacity); }

        public synchronized void add(String line) {
            q.addLast(new Entry(++nextId, line));
            while (q.size() > capacity) { q.pollFirst(); dropped++; }
        }

        /** Everything queued now, as one jsonline body; null when empty. */
        public synchronized Batch snapshot() {
            if (q.isEmpty()) return null;
            StringBuilder sb = new StringBuilder();
            for (Entry e : q) sb.append(e.line);
            return new Batch(sb.toString(), q.peekLast().id, q.size());
        }

        /** The batch was stored: drop every line it contained that is still queued. */
        public synchronized void ack(Batch b) {
            if (b == null) return;
            while (!q.isEmpty() && q.peekFirst().id <= b.lastId) q.pollFirst();
        }

        public synchronized void clear() { q.clear(); }
        public synchronized int size() { return q.size(); }
        public synchronized int dropped() { return dropped; }
    }
}
