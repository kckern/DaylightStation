package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Audit H7: Back from Now playing shows the place just heard, and a book heard to its end goes. */
public class HeardHereTest {
    private static JSONArray rows(int partIndex, int partCount) throws Exception {
        return new JSONArray().put(new JSONObject().put("contentId", "plex:book").put("playContentId", "plex:part")
                .put("playhead", 100).put("duration", 1000).put("remainingSec", 5000)
                .put("partIndex", partIndex).put("partCount", partCount));
    }

    @Test public void theRowTakesThisPhonesFresherPlace() throws Exception {
        HeardHere h = new HeardHere();
        h.heard("plex:part", 400, false, 1_000);
        JSONObject r = h.patch(rows(2, 5), 60_000).getJSONObject(0);
        assertEquals(400, r.getLong("playhead"));
        assertEquals(4700, r.getLong("remainingSec"));
    }

    @Test public void anOldOrOtherReportLeavesHomesAnswer() throws Exception {
        HeardHere h = new HeardHere();
        h.heard("plex:part", 400, false, 1_000);
        assertEquals(100, h.patch(rows(2, 5), 1_000 + HeardHere.FRESH_MS + 1).getJSONObject(0).getLong("playhead"));
        h.heard("plex:other", 400, false, 1_000);
        HeardHere fresh = new HeardHere();
        fresh.heard("plex:other", 900, false, 1_000);
        assertEquals(100, fresh.patch(rows(2, 5), 2_000).getJSONObject(0).getLong("playhead"));
    }

    @Test public void aBookHeardToTheEndOfItsLastPartIsLeftOut() throws Exception {
        HeardHere h = new HeardHere();
        h.heard("plex:part", 1000, true, 1_000);
        assertEquals(0, h.patch(rows(5, 5), 2_000).length());
        assertEquals("a middle part's end is not the book's", 1, h.patch(rows(2, 5), 2_000).length());
    }
}
