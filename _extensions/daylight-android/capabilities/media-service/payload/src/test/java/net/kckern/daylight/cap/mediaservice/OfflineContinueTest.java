package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Continue listening with no home: the kept, started, unfinished books (acceptance 212, "vanishes offline"). */
public class OfflineContinueTest {
    private static JSONObject book(String cid, String title, String kind, int parts, long partMs) throws Exception {
        JSONArray tracks = new JSONArray();
        for (int i = 1; i <= parts; i++) {
            tracks.put(new JSONObject().put("id", cid + i).put("url", "https://h/" + i).put("title", "Part " + i)
                    .put("artist", "An Author").put("durationMs", partMs));
        }
        return new JSONObject().put("contentId", cid).put("title", title).put("kind", kind).put("art", "https://h/art.jpg").put("tracks", tracks);
    }

    private static Map<String, JSONObject> heard(Object... idSecAt) throws Exception {
        Map<String, JSONObject> m = new HashMap<>();
        for (int i = 0; i < idSecAt.length; i += 3) {
            m.put((String) idSecAt[i], new JSONObject().put("seconds", (long) (Integer) idSecAt[i + 1]).put("observedAt", (long) (Integer) idSecAt[i + 2]));
        }
        return m;
    }

    @Test public void aStartedKeptBookShowsWithItsPlaceAndTimeLeft() throws Exception {
        List<JSONObject> kept = Arrays.asList(book("plex:10", "A Long Book", "book", 3, 3_000_000L));
        Map<String, JSONObject> h = heard("plex:102", 600, 5);
        JSONArray rows = OfflineContinue.rows(kept, h::get, 6);
        assertEquals(1, rows.length());
        JSONObject r = rows.getJSONObject(0);
        assertEquals("plex:10", r.getString("contentId"));
        assertEquals("plex:102", r.getString("playContentId"));
        assertEquals("p:plex:102", r.getString("id"));
        assertEquals("A Long Book", r.getString("title"));
        assertEquals(600, r.getLong("playhead"));
        assertEquals(3000, r.getLong("duration"));
        assertEquals(2400 + 3000, r.getLong("remainingSec"));
        assertEquals(2, r.getInt("partIndex"));
        assertEquals(3, r.getInt("partCount"));
        assertEquals("An Author", r.getString("subtitle"));
        assertEquals("https://h/art.jpg", r.getString("art"));
    }

    @Test public void aKeptBookNeverStartedIsNotContinue() throws Exception {
        List<JSONObject> kept = Arrays.asList(book("plex:10", "A Long Book", "book", 3, 3_000_000L));
        assertEquals(0, OfflineContinue.rows(kept, id -> null, 6).length());
    }

    @Test public void aFinishedBookAndAnAlbumAreLeftOut() throws Exception {
        List<JSONObject> kept = Arrays.asList(book("plex:10", "Done", "book", 2, 1_200_000L), book("plex:20", "An Album", "album", 2, 1_200_000L));
        Map<String, JSONObject> h = heard("plex:102", 1199, 9, "plex:201", 100, 9);
        assertEquals(0, OfflineContinue.rows(kept, h::get, 6).length());
    }

    @Test public void aFinishedPartMovesOnToTheNextFromItsStart() throws Exception {
        List<JSONObject> kept = Arrays.asList(book("plex:10", "A Long Book", "book", 3, 1_200_000L));
        Map<String, JSONObject> h = heard("plex:101", 1199, 9);
        JSONObject r = OfflineContinue.rows(kept, h::get, 6).getJSONObject(0);
        assertEquals("plex:102", r.getString("playContentId"));
        assertEquals(0, r.getLong("playhead"));
        assertEquals(2400, r.getLong("remainingSec"));
    }

    @Test public void newestListenedFirstAndLimited() throws Exception {
        List<JSONObject> kept = Arrays.asList(book("plex:30", "Older", "book", 1, 3_000_000L), book("plex:40", "Newer", "book", 1, 3_000_000L));
        Map<String, JSONObject> h = heard("plex:301", 10, 1, "plex:401", 10, 2);
        JSONArray rows = OfflineContinue.rows(kept, h::get, 6);
        assertEquals("Newer", rows.getJSONObject(0).getString("title"));
        assertEquals(1, OfflineContinue.rows(kept, h::get, 1).length());
        assertTrue(rows.getJSONObject(0).getBoolean("offline"));
    }
}
