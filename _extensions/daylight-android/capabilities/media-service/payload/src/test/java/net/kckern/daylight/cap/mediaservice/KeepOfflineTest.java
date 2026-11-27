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
        List<String> orphaned = kept.remove("plex:10", 5);
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
        // The whole book resumes where it was last heard (audit 2): not chapter 1.
        Resolver.Resolved whole = Offline.resolve("c:plex:10", kept, positions);
        assertEquals(1, whole.startIndex);
        assertEquals(404_000, whole.startPositionMs);
        // The newest heard wins, whatever the order of the parts.
        positions.keep(new JSONObject().put("assetId", "plex:11").put("seconds", 50).put("observedAt", 10));
        positions.keep(new JSONObject().put("assetId", "plex:13").put("seconds", 70).put("observedAt", 20));
        assertEquals(2, Offline.resolve("c:plex:10", kept, positions).startIndex);
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

    @Test public void anAutomaticKeepKeepsItsScopeThroughARefreshAndAManualKeepEndsIt() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:30", "A course", null, tracks("plex:32", "plex:33", "plex:34"), 1, "album",
                java.util.Arrays.asList("plex:32", "plex:33", "plex:34"));
        JSONObject k = kept.get("plex:30");
        assertTrue(KeptCollections.auto(k));
        assertEquals(java.util.Arrays.asList("plex:32", "plex:33", "plex:34"), KeptCollections.only(k));
        // A re-sync stays automatic, to the same lectures.
        kept.refreshIfKept("plex:30", "A course", null, tracks("plex:32", "plex:33", "plex:34"), 5, "album");
        assertTrue(KeptCollections.auto(kept.get("plex:30")));
        assertEquals(3, KeptCollections.only(kept.get("plex:30")).size());
        // Restored from the shell's mirror: still automatic.
        org.json.JSONArray mirror = new org.json.JSONArray().put(kept.get("plex:30"));
        kept.remove("plex:30", 6);
        kept.save("plex:30", "A course", null, tracks("plex:32"), 7, "album", java.util.Collections.emptyList());
        assertTrue("the whole collection kept automatically has no scope", KeptCollections.only(kept.get("plex:30")).isEmpty());
        // Keep by hand: a manual keep, never removed by the automatic rules.
        kept.save("plex:30", "A course", null, tracks("plex:31", "plex:32", "plex:33", "plex:34"), 8, "album");
        assertTrue(!KeptCollections.auto(kept.get("plex:30")));
        KeptCollections other = new KeptCollections(tmp.newFolder("kept2"));
        assertEquals(1, other.restore(mirror));
        assertTrue(KeptCollections.auto(other.get("plex:30")));
    }

    @Test public void anAutomaticKeepHoldsOnlyItsPartsInPlayOrder() throws Exception {
        java.util.List<Track> all = new java.util.ArrayList<>();
        for (String id : new String[] { "plex:41", "plex:42", "plex:43", "plex:44" }) {
            all.add(new Track(id, "https://home.example/s/" + id, "T", "", "Course", null, "talks", 1_800_000));
        }
        java.util.List<Track> got = MediaServiceCapability.scoped(all, java.util.Arrays.asList("plex:43", "plex:42"));
        assertEquals(2, got.size());
        assertEquals("plex:42", got.get(0).id);
        assertEquals("plex:43", got.get(1).id);
    }
}
