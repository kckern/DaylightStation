package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Cover for the `t` field on outbound note.on/note.off (p20+): the MIDI receiver's
 * nanoTime-based timestamp converted to epoch ms, so the kiosk can grade the moment
 * the key went down instead of the moment the WebView read the socket.
 */
public class NoteTimeTest {

    @Test public void convertsNanoTimestampToEpochMs() {
        long nowMs = 1_800_000_000_000L;
        long nowNanos = 5_000_000_000L;
        // Event happened 37 ms before the sample pair.
        long eventNanos = nowNanos - 37_000_000L;
        assertEquals(nowMs - 37, ControlServer.midiEventEpochMs(eventNanos, nowMs, nowNanos));
    }

    @Test public void roundsSubMillisecondAge() {
        long nowMs = 1_800_000_000_000L;
        long nowNanos = 5_000_000_000L;
        assertEquals(nowMs - 2, ControlServer.midiEventEpochMs(nowNanos - 1_600_000L, nowMs, nowNanos));
    }

    @Test public void zeroTimestampFallsBackToReceiptTime() {
        assertEquals(42L, ControlServer.midiEventEpochMs(0L, 42L, 999L));
        assertEquals(42L, ControlServer.midiEventEpochMs(-5L, 42L, 999L));
    }

    @Test public void noteJsonCarriesT() throws Exception {
        JSONObject on = new JSONObject(ControlServer.buildNote("note.on", 60, 90, 1_800_000_000_123L));
        assertEquals("note.on", on.getString("type"));
        assertEquals(60, on.getInt("note"));
        assertEquals(90, on.getInt("velocity"));
        assertEquals(1_800_000_000_123L, on.getLong("t"));

        JSONObject off = new JSONObject(ControlServer.buildNote("note.off", 60, -1, 1_800_000_000_200L));
        assertFalse(off.has("velocity"));
        assertEquals(1_800_000_000_200L, off.getLong("t"));
    }

    @Test public void noTimeMeansNoTField() throws Exception {
        JSONObject on = new JSONObject(ControlServer.buildNote("note.on", 60, 90, 0L));
        assertFalse(on.has("t"));
    }
}
