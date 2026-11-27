package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

public class TelemetryDrainTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private PayloadPort.Handler attached;

    @After public void detach() { if (attached != null) PayloadPort.named(UiTelemetry.PORT).detach(attached); }

    private static JSONObject ev(int i) throws Exception {
        return new JSONObject().put("id", "e" + i).put("event", "ui.tap");
    }

    private TelemetryStore storeWithBatches(int batches) throws Exception {
        TelemetryStore s = new TelemetryStore(tmp.newFolder("t"));
        for (int b = 0; b < batches; b++) { s.append(ev(b)); s.seal(); }
        return s;
    }

    @Test public void everyBatchIsSentOldestFirstAndDeletedOnceAccepted() throws Exception {
        TelemetryStore s = storeWithBatches(3);
        s.append(ev(99)); // still open: the drain seals it too
        List<String> seen = new ArrayList<>();
        TelemetryDrain.Result r = TelemetryDrain.drain(s, events -> {
            seen.add(events.optJSONObject(0).optString("id"));
            return TelemetryDrain.SENT;
        });
        assertEquals(4, r.sent);
        assertFalse(r.left);
        assertEquals(0, s.waiting());
        assertEquals(java.util.Arrays.asList("e0", "e1", "e2", "e99"), seen);
    }

    @Test public void offlineKeepsTheBatchAndEverythingAfterIt() throws Exception {
        TelemetryStore s = storeWithBatches(3);
        int[] calls = { 0 };
        TelemetryDrain.Result r = TelemetryDrain.drain(s, events -> ++calls[0] == 1 ? TelemetryDrain.SENT : TelemetryDrain.LATER);
        assertEquals(1, r.sent);
        assertTrue(r.left);
        assertEquals(2, r.waiting);
        assertEquals(2, s.waiting());
        assertEquals("the next drain starts from the one that waited", "e1", s.next().events.getJSONObject(0).getString("id"));
    }

    @Test public void aBatchRefusedForGoodIsDroppedSoTheRestStillGo() throws Exception {
        TelemetryStore s = storeWithBatches(2);
        int[] calls = { 0 };
        TelemetryDrain.Result r = TelemetryDrain.drain(s, events -> ++calls[0] == 1 ? TelemetryDrain.REFUSED : TelemetryDrain.SENT);
        assertEquals(1, r.refused);
        assertEquals(1, r.sent);
        assertEquals(0, s.waiting());
    }

    @Test public void nothingWaitingIsNotAnError() throws Exception {
        TelemetryStore s = new TelemetryStore(tmp.newFolder("t"));
        TelemetryDrain.Result r = TelemetryDrain.drain(s, events -> { throw new AssertionError("nothing to send"); });
        assertFalse(r.left);
        assertEquals(0, r.sent);
    }

    @Test public void thePortSenderGoesThroughThePayloadsTelemetryPort() throws Exception {
        TelemetryStore s = storeWithBatches(2);
        List<JSONObject> requests = new ArrayList<>();
        attached = req -> { requests.add(new JSONObject(req)); return new JSONObject().put("ok", true).put("status", 202).toString(); };
        PayloadPort.named(UiTelemetry.PORT).attach(attached);
        TelemetryDrain.Result r = TelemetryDrain.drain(s, TelemetryDrain.port(1000));
        assertEquals(2, r.sent);
        assertEquals(0, s.waiting());
        assertEquals("android", requests.get(0).getString("source"));
        assertEquals(1, requests.get(0).getJSONArray("events").length());
    }

    @Test public void noPayloadMeansLaterAndTheBatchesStay() throws Exception {
        TelemetryStore s = storeWithBatches(1);
        TelemetryDrain.Result r = TelemetryDrain.drain(s, TelemetryDrain.port(0));
        assertTrue(r.left);
        assertEquals(1, s.waiting());
    }

    @Test public void homeDownIsLaterAndABadRequestIsForGood() throws Exception {
        assertEquals(TelemetryDrain.LATER, TelemetryDrain.outcome(new JSONObject().put("ok", false).put("status", 503)));
        assertEquals(TelemetryDrain.LATER, TelemetryDrain.outcome(new JSONObject().put("ok", false).put("status", 0)));
        assertEquals(TelemetryDrain.REFUSED, TelemetryDrain.outcome(new JSONObject().put("ok", false).put("status", 413)));
        assertEquals(TelemetryDrain.SENT, TelemetryDrain.outcome(new JSONObject().put("ok", true)));
        assertTrue(new JSONArray().length() == 0);
    }
}
