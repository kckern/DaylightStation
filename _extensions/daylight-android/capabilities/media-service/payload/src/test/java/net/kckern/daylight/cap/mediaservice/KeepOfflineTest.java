package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;

/** Keep on this phone: kept collections, the offline answer, and progress that waits for a network. */
public class KeepOfflineTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static JSONArray tracks(String... ids) throws Exception {
        JSONArray a = new JSONArray();
        for (String id : ids) a.put(new JSONObject().put("id", id).put("url", "https://home.example/api/v1/proxy/plex/stream/" + id.substring(5))
                .put("title", "T " + id).put("durationMs", 600_000));
        return a;
    }

    @Test public void keptCollectionsAnswerByCollectionOrByTrack() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:10", "A book", null, tracks("plex:11", "plex:12", "plex:13"), 1);
        kept.save("plex:20", "An album", "https://x/a.jpg", tracks("plex:21", "plex:12"), 2);
        assertEquals("plex:20", kept.list().get(0).getString("contentId"));
        assertEquals("plex:10", kept.holding("plex:13").getString("contentId"));
        assertNull(kept.holding("plex:99"));
        // Removing a collection frees only the tracks no other kept collection holds.
        List<String> orphaned = kept.remove("plex:10");
        assertEquals(List.of("plex:11", "plex:13"), orphaned);
        assertEquals(1, kept.list().size());
    }

    @Test public void offlineAPlayOfAKeptTrackContinuesTheCollectionFromThere() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        PendingProgress positions = new PendingProgress(new java.io.File(tmp.newFolder("p"), "positions.json"));
        kept.save("plex:10", "A book", null, tracks("plex:11", "plex:12", "plex:13"), 1);
        positions.keep(new JSONObject().put("assetId", "plex:12").put("seconds", 404));
        Resolver.Resolved r = Offline.resolve("p:plex:12", kept, positions);
        assertEquals(3, r.tracks.size());
        assertEquals(1, r.startIndex);
        assertEquals("resumes where this phone last was", 404_000, r.startPositionMs);
        Resolver.Resolved whole = Offline.resolve("c:plex:10", kept, positions);
        assertEquals(0, whole.startIndex);
        assertNull("nothing kept answers a stranger", Offline.resolve("p:plex:99", kept, positions));
    }

    @Test public void progressWaitsNewestFirstPerItem() throws Exception {
        PendingProgress pending = new PendingProgress(new java.io.File(tmp.newFolder("q"), "pending.json"));
        pending.keep(new JSONObject().put("assetId", "plex:12").put("seconds", 100));
        pending.keep(new JSONObject().put("assetId", "plex:12").put("seconds", 160));
        pending.keep(new JSONObject().put("assetId", "plex:13").put("seconds", 5));
        assertEquals(2, pending.waiting().size());
        long at12 = 0;
        for (JSONObject b : pending.waiting()) if ("plex:12".equals(b.getString("assetId"))) at12 = b.getLong("seconds");
        assertEquals(160, at12);
        pending.sent("plex:12");
        assertEquals(1, pending.waiting().size());
        assertTrue(pending.waiting().get(0).getString("assetId").equals("plex:13"));
    }
}
