package net.kckern.daylight.cap.widgets.shell;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Audit H16: the Capture tab says what its captures are doing. */
public class CaptureCountsTest {
    private static JSONArray rows(String... states) throws Exception {
        JSONArray a = new JSONArray();
        for (String s : states) a.put(new JSONObject().put("state", s));
        return a;
    }

    @Test public void attentionFirstThenWaitingThenSent() throws Exception {
        assertEquals("1 needs attention · 2 waiting to send · 3 sent",
                CaptureCounts.line(rows("REJECTED", "QUEUED", "RETRY", "DELIVERED", "ACCEPTED", "DELIVERED")));
        assertEquals("2 sent", CaptureCounts.line(rows("DELIVERED", "DELIVERED")));
        assertEquals("1 waiting to send", CaptureCounts.line(rows("PROCESSING")));
        assertEquals("Nothing captured yet", CaptureCounts.line(new JSONArray()));
        assertEquals("Nothing captured yet", CaptureCounts.line(null));
    }
}
