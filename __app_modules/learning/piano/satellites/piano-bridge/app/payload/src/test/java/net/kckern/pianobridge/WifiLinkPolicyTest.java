package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * 2026-10-28: lesson videos stalled on the piano tablet for seven minutes while the
 * server, Plex and the LAN all checked out. Delivery to the tablet had collapsed, and
 * nothing could say whether its Wi-Fi link was the cause because nothing recorded it.
 * These pin the arithmetic that turns raw WifiInfo + TrafficStats readings into the
 * verdicts the log store will be asked about next time.
 */
public class WifiLinkPolicyTest {

    private static final WifiLinkPolicy.Thresholds T = new WifiLinkPolicy.Thresholds(-75, 20);

    private static WifiLinkPolicy.Reading reading(long elapsedMs, int rssi, int link, int freq,
                                                  String bssid, long rx, long tx) {
        WifiLinkPolicy.Reading r = new WifiLinkPolicy.Reading();
        r.epochMs = 1_800_000_000_000L + elapsedMs;
        r.elapsedMs = elapsedMs;
        r.connected = true;
        r.rssi = rssi;
        r.linkSpeedMbps = link;
        r.rxLinkSpeedMbps = link;
        r.txLinkSpeedMbps = link;
        r.freqMhz = freq;
        r.bssid = bssid;
        r.ssid = "\"house\"";
        r.rxBytes = rx;
        r.txBytes = tx;
        return r;
    }

    // --- throughput ---------------------------------------------------------

    @Test public void kbpsIsBitsPerMillisecond() {
        // 125_000 bytes in 1s = 1_000_000 bits/s = 1000 kbps
        assertEquals(1000, WifiLinkPolicy.kbps(0, 125_000, 1000));
        // 2.4 Mbps lesson video for 10s = 3_000_000 bytes
        assertEquals(2400, WifiLinkPolicy.kbps(1_000_000, 4_000_000, 10_000));
    }

    @Test public void counterResetOrNegativeDeltaIsUnknownNotANegativeRate() {
        // TrafficStats counters reset on interface bounce; a negative delta is not traffic.
        assertEquals(-1, WifiLinkPolicy.kbps(5_000_000, 1_000, 10_000));
    }

    @Test public void unsupportedCountersOrNoElapsedTimeAreUnknown() {
        // TrafficStats.UNSUPPORTED == -1
        assertEquals(-1, WifiLinkPolicy.kbps(-1, 100, 1000));
        assertEquals(-1, WifiLinkPolicy.kbps(0, -1, 1000));
        assertEquals(-1, WifiLinkPolicy.kbps(0, 100, 0));
        assertEquals(-1, WifiLinkPolicy.kbps(0, 100, -5));
    }

    @Test public void idleLinkIsZeroNotUnknown() {
        assertEquals(0, WifiLinkPolicy.kbps(1000, 1000, 10_000));
    }

    // --- band ---------------------------------------------------------------

    @Test public void bandFromFrequency() {
        assertEquals("2.4GHz", WifiLinkPolicy.band(2412));
        assertEquals("2.4GHz", WifiLinkPolicy.band(2484));
        assertEquals("5GHz", WifiLinkPolicy.band(5180));
        assertEquals("5GHz", WifiLinkPolicy.band(5825));
        assertEquals("6GHz", WifiLinkPolicy.band(5955));
        assertEquals("6GHz", WifiLinkPolicy.band(7115));
        assertEquals("unknown", WifiLinkPolicy.band(-1));
        assertEquals("unknown", WifiLinkPolicy.band(0));
        assertEquals("unknown", WifiLinkPolicy.band(900));
    }

    // --- identity normalization ---------------------------------------------

    @Test public void placeholderBssidAndSsidAreNull() {
        // Without location access Android redacts both; never report them as a real AP.
        assertNull(WifiLinkPolicy.normalizeBssid("02:00:00:00:00:00"));
        assertNull(WifiLinkPolicy.normalizeBssid(null));
        assertNull(WifiLinkPolicy.normalizeBssid(""));
        assertNull(WifiLinkPolicy.normalizeBssid("00:00:00:00:00:00"));
        assertEquals("aa:bb:cc:dd:ee:ff", WifiLinkPolicy.normalizeBssid("AA:BB:CC:DD:EE:FF"));
        assertNull(WifiLinkPolicy.normalizeSsid("<unknown ssid>"));
        assertNull(WifiLinkPolicy.normalizeSsid(null));
        assertNull(WifiLinkPolicy.normalizeSsid("\"\""));
        assertEquals("house", WifiLinkPolicy.normalizeSsid("\"house\""));
        assertEquals("bare", WifiLinkPolicy.normalizeSsid("bare"));
    }

    // --- degraded verdict ---------------------------------------------------

    @Test public void weakSignalAtOrBelowThresholdIsDegraded() {
        assertEquals("rssi", WifiLinkPolicy.degradedReason(true, -75, 72, T));
        assertNull(WifiLinkPolicy.degradedReason(true, -74, 72, T));
    }

    @Test public void slowLinkRateIsDegraded() {
        assertEquals("linkSpeed", WifiLinkPolicy.degradedReason(true, -50, 19, T));
        assertNull(WifiLinkPolicy.degradedReason(true, -50, 20, T));
    }

    @Test public void bothReasonsAreNamed() {
        assertEquals("rssi,linkSpeed", WifiLinkPolicy.degradedReason(true, -80, 6, T));
    }

    @Test public void disconnectedIsDegraded() {
        assertEquals("disconnected", WifiLinkPolicy.degradedReason(false, -127, -1, T));
    }

    @Test public void invalidReadingsDoNotCountAsDegraded() {
        // -127 is WifiInfo.INVALID_RSSI; a link speed of -1 is LINK_SPEED_UNKNOWN.
        assertNull(WifiLinkPolicy.degradedReason(true, -127, -1, T));
    }

    // --- tracker: deltas, roams ---------------------------------------------

    @Test public void firstSampleHasNoRateAndNoRoam() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        WifiLinkPolicy.Sample s = tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 1000, 500), T);
        assertEquals(-1, s.rxKbps);
        assertEquals(-1, s.txKbps);
        assertFalse(s.roamed);
        assertFalse(s.degraded);
        assertEquals("5GHz", s.band);
        assertEquals("house", s.ssid);
    }

    @Test public void secondSampleCarriesRatesFromTheDelta() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        WifiLinkPolicy.Sample s = tr.add(reading(10_000, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 3_000_000, 125_000), T);
        assertEquals(2400, s.rxKbps);
        assertEquals(100, s.txKbps);
    }

    @Test public void bssidChangeIsARoamWithFromAndTo() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        WifiLinkPolicy.Sample s = tr.add(reading(10_000, -70, 52, 2437, "aa:aa:aa:aa:aa:02", 10, 10), T);
        assertTrue(s.roamed);
        assertEquals("aa:aa:aa:aa:aa:01", s.roamFrom);
        assertEquals(5180, s.roamFromFreqMhz);
        assertEquals("aa:aa:aa:aa:aa:02", s.bssid);
    }

    @Test public void sameBssidIsNotARoam() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        assertFalse(tr.add(reading(10_000, -60, 144, 5180, "AA:AA:AA:AA:AA:01", 0, 0), T).roamed);
    }

    @Test public void roamAcrossADisconnectIsStillSeen() {
        // AP1 -> (no association) -> AP2 is a roam; the gap must not erase where we were.
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        WifiLinkPolicy.Reading gone = reading(10_000, -127, -1, -1, "02:00:00:00:00:00", 0, 0);
        gone.connected = false;
        WifiLinkPolicy.Sample g = tr.add(gone, T);
        assertFalse(g.roamed);
        assertTrue(g.degraded);
        assertEquals("disconnected", g.degradedReason);
        WifiLinkPolicy.Sample back = tr.add(reading(20_000, -60, 144, 5180, "aa:aa:aa:aa:aa:02", 0, 0), T);
        assertTrue(back.roamed);
        assertEquals("aa:aa:aa:aa:aa:01", back.roamFrom);
    }

    @Test public void reassociatingToTheSameApAfterADropIsNotARoam() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        WifiLinkPolicy.Reading gone = reading(10_000, -127, -1, -1, null, 0, 0);
        gone.connected = false;
        tr.add(gone, T);
        assertFalse(tr.add(reading(20_000, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T).roamed);
    }

    @Test public void counterResetBetweenSamplesYieldsUnknownThenRecovers() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 9_000_000, 9_000_000), T);
        WifiLinkPolicy.Sample reset = tr.add(reading(10_000, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 100, 100), T);
        assertEquals(-1, reset.rxKbps);
        WifiLinkPolicy.Sample next = tr.add(reading(20_000, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 125_100, 100), T);
        assertEquals(100, next.rxKbps);
    }

    // --- ring + JSON --------------------------------------------------------

    @Test public void ringKeepsOnlyTheNewestSamplesOldestFirst() throws Exception {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(3);
        for (int i = 0; i < 5; i++) tr.add(reading(i * 10_000L, -50 - i, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        JSONArray recent = tr.recentJson();
        assertEquals(3, recent.length());
        assertEquals(-52, recent.getJSONObject(0).getInt("rssi"));
        assertEquals(-54, recent.getJSONObject(2).getInt("rssi"));
        assertEquals(-54, tr.latest().rssi);
        assertEquals(5, tr.latest().seq);
    }

    @Test public void emptyTrackerHasNoLatest() {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        assertNull(tr.latest());
        assertEquals(0, tr.recentJson().length());
    }

    @Test public void sampleJsonCarriesTheQueryableFieldNames() throws Exception {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T);
        JSONObject o = tr.add(reading(10_000, -78, 13, 2437, "aa:aa:aa:aa:aa:02", 12_500, 0), T).toJson();
        assertEquals(-78, o.getInt("rssi"));
        assertEquals(13, o.getInt("linkSpeedMbps"));
        assertEquals(13, o.getInt("rxLinkSpeedMbps"));
        assertEquals(13, o.getInt("txLinkSpeedMbps"));
        assertEquals(2437, o.getInt("freqMhz"));
        assertEquals("2.4GHz", o.getString("band"));
        assertEquals("aa:aa:aa:aa:aa:02", o.getString("bssid"));
        assertEquals("house", o.getString("ssid"));
        assertEquals(10, o.getLong("rxKbps"));
        assertEquals(0, o.getLong("txKbps"));
        assertTrue(o.getBoolean("connected"));
        assertTrue(o.getBoolean("degraded"));
        assertEquals("rssi,linkSpeed", o.getString("degradedReason"));
        assertTrue(o.getBoolean("roamed"));
        assertEquals("aa:aa:aa:aa:aa:01", o.getString("roamFrom"));
        assertTrue(o.has("epochMs"));
        assertTrue(o.has("seq"));
    }

    @Test public void compactJsonIsTheHeartbeatSubset() throws Exception {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        JSONObject c = tr.add(reading(0, -55, 144, 5180, "aa:aa:aa:aa:aa:01", 0, 0), T).toCompactJson();
        assertEquals(-55, c.getInt("rssi"));
        assertEquals(144, c.getInt("linkSpeedMbps"));
        assertEquals(5180, c.getInt("freqMhz"));
        assertEquals("5GHz", c.getString("band"));
        assertEquals("aa:aa:aa:aa:aa:01", c.getString("bssid"));
        assertEquals(-1, c.getLong("rxKbps"));
        assertFalse(c.getBoolean("degraded"));
        assertFalse("ssid stays out of the per-minute beat", c.has("ssid"));
    }

    @Test public void unknownIdentityIsJsonNullNotAPlaceholder() throws Exception {
        WifiLinkPolicy.Tracker tr = new WifiLinkPolicy.Tracker(60);
        WifiLinkPolicy.Reading r = reading(0, -55, 144, 5180, "02:00:00:00:00:00", 0, 0);
        r.ssid = "<unknown ssid>";
        JSONObject o = tr.add(r, T).toJson();
        assertTrue(o.isNull("bssid"));
        assertTrue(o.isNull("ssid"));
    }

    // --- log line timestamp -------------------------------------------------

    @Test public void logLineCanCarryTheSampleTimeNotTheSendTime() throws Exception {
        // Samples taken while the link was down are sent late; their _time must be
        // when they were measured, or the outage would appear to have no samples.
        String line = Heartbeat.toLogStoreLine("bridge.wifi", "warn", "dev", new JSONObject().put("rssi", -80),
                1787457600000L);
        JSONObject o = new JSONObject(line.trim());
        assertEquals("2026-08-23T04:00:00.000Z", o.getString("_time"));
        assertEquals("bridge.wifi", o.getString("_msg"));
        assertEquals("warn", o.getString("level"));
        assertEquals(-80, o.getInt("data.rssi"));
        assertEquals("piano-bridge", o.getString("context.app"));
    }
}
