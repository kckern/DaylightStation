package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * The heartbeat's value is that ABSENCE is queryable, which only works if every
 * line lands in the store with the same envelope the rest of DaylightStation uses.
 * So the line shape is pinned: a drift here would silently break the one query
 * that tells you a tablet at sea has gone dark.
 */
public class HeartbeatTest {

    @Test public void logStoreLineCarriesTheStandardEnvelope() throws Exception {
        JSONObject body = new JSONObject()
                .put("deviceId", "yellow-room-tablet")
                .put("seq", 7)
                .put("ble", "CONNECTED");
        JSONObject line = new JSONObject(Heartbeat.toLogStoreLine(body).trim());
        assertEquals("bridge.heartbeat", line.getString("_msg"));
        assertEquals("info", line.getString("level"));
        assertEquals("piano-bridge", line.getString("context.app"));
        assertEquals("piano-bridge", line.getString("context.source"));
        assertEquals("yellow-room-tablet", line.getString("context.device"));
        assertTrue("ISO-8601 UTC with Z", line.getString("_time").endsWith("Z"));
    }

    @Test public void bodyFieldsAreFlattenedUnderDataSoLogsQLCanFilterThem() throws Exception {
        // data.ble:CONNECTED and data.beatFailures.logStore:0 must be direct keys —
        // VictoriaLogs indexes top-level fields, not nested objects.
        JSONObject body = new JSONObject()
                .put("ble", "CONNECTED")
                .put("beatFailures", new JSONObject().put("logStore", 0).put("backend", 2));
        JSONObject line = new JSONObject(Heartbeat.toLogStoreLine(body).trim());
        assertEquals("CONNECTED", line.getString("data.ble"));
        assertEquals(0, line.getInt("data.beatFailures.logStore"));
        assertEquals(2, line.getInt("data.beatFailures.backend"));
    }

    @Test public void lineIsNewlineTerminatedForJsonlineInsert() {
        String s = Heartbeat.toLogStoreLine(new JSONObject());
        assertTrue(s.endsWith("\n"));
        assertEquals(1, s.split("\n").length);
    }

    @Test public void isoIsUtcMillis() {
        // 2026-08-23T04:00:00.000Z exactly
        assertEquals("2026-08-23T04:00:00.000Z", Heartbeat.iso(1787457600000L));
    }
}
