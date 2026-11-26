package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Set;

/** Nothing kept is deleted unless someone removed it: plan B (two-key delete, quarantine, restore). */
public class KeptCollectionsSafetyTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static JSONArray tracks(String... ids) throws Exception {
        JSONArray a = new JSONArray();
        for (String id : ids) a.put(new JSONObject().put("id", id).put("url", "https://h/s/" + id).put("title", id));
        return a;
    }

    @Test public void onlyAnExplicitRemovalMakesAudioDeletable() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:10", "Album", null, tracks("plex:11", "plex:12"), 1);
        kept.save("plex:20", "Playlist", null, tracks("plex:12", "plex:21"), 2);
        assertTrue(kept.deletable().isEmpty());
        kept.remove("plex:10", 3);
        // plex:12 is still in the playlist: one copy, kept.
        assertEquals(Set.of("plex:11"), kept.deletable());
        assertTrue(kept.tombstoned("plex:10"));
    }

    @Test public void aCorruptKeptFileIsQuarantinedNotRemoved() throws Exception {
        File dir = tmp.newFolder("kept");
        KeptCollections kept = new KeptCollections(dir);
        kept.save("plex:10", "Album", null, tracks("plex:11"), 1);
        Files.write(new File(dir, "plex_10.json").toPath(), "{not json".getBytes(StandardCharsets.UTF_8));
        assertTrue(kept.list().isEmpty());
        assertEquals(1, kept.quarantined().size());
        assertTrue("a file that cannot be read is not a removal", kept.deletable().isEmpty());
        assertFalse(kept.tombstoned("plex:10"));
    }

    @Test public void anEmptyListIsReseededFromTheShellsMirrorButNotARemovedOne() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:30", "Removed", null, tracks("plex:31"), 1);
        kept.remove("plex:30", 2);
        JSONArray mirror = new JSONArray()
                .put(new JSONObject().put("contentId", "plex:10").put("title", "Album").put("tracks", tracks("plex:11")).put("keptAt", 5))
                .put(new JSONObject().put("contentId", "plex:30").put("title", "Removed").put("tracks", tracks("plex:31")).put("keptAt", 1));
        assertEquals(1, kept.restore(mirror));
        assertEquals("plex:10", kept.list().get(0).getString("contentId"));
        assertEquals(0, kept.restore(mirror));
    }

    @Test public void keepingAgainCancelsTheOldRemoval() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:10", "Album", null, tracks("plex:11"), 1);
        kept.remove("plex:10", 2);
        kept.save("plex:10", "Album", null, tracks("plex:11"), 3);
        assertFalse(kept.tombstoned("plex:10"));
        assertTrue(kept.deletable().isEmpty());
    }

    @Test public void theCarListsKeptCollectionsAndTheirTracksFromThePhone() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:10", "Book", null, tracks("plex:11", "plex:12", "plex:13"), 1);
        java.util.List<MediaNode> roots = BrowseTree.keptNodes(kept.list(), 50, "Offline: showing what is on this phone");
        assertEquals(MediaId.KEPT, roots.get(0).id);
        assertEquals("c:plex:10", roots.get(1).id);
        assertTrue(roots.get(1).playable);
        java.util.List<MediaNode> page = BrowseTree.keptTracks(kept.get("plex:10"), 1, 50);
        assertEquals(2, page.size());
        assertEquals("p:plex:12|plex:10", page.get(0).id);
        assertEquals(null, BrowseTree.rootsProblem("Drive=drive:;Continue=continue;Recent=recent;On phone=kept"));
    }

    @Test public void homeThatFailedIsDownForAMinuteAndAnyAnswerBringsItBack() {
        BackendHealth h = new BackendHealth();
        assertFalse(h.down(0));
        h.failed(1_000);
        assertTrue(h.down(30_000));
        assertFalse(h.down(61_001));
        h.failed(100_000);
        h.answered();
        assertFalse(h.down(100_001));
    }

    @Test public void offlineReportsReplayOldestHeardFirstAndCarryWhenHeard() throws Exception {
        PendingProgress p = new PendingProgress(new File(tmp.newFolder("p"), "pending.json"));
        p.keep(new JSONObject().put("assetId", "plex:2").put("seconds", 50).put("observedAt", 2_000));
        p.keep(new JSONObject().put("assetId", "plex:1").put("seconds", 40).put("observedAt", 1_000));
        assertEquals("plex:1", p.waiting().get(0).getString("assetId"));
        ProgressReporter.Report r = new ProgressReporter.Report("plex:1", "T", "", 40, 10.0, false);
        r.observedAt = 1234;
        assertEquals(1234, r.toBody().getLong("observedAt"));
    }

    @Test public void aResyncReleasesOnlyTheTracksTakenOffTheList() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:40", "Playlist", null, tracks("plex:41", "plex:42", "plex:43"), 1);
        kept.save("plex:50", "Album", null, tracks("plex:42"), 1);
        kept.release("plex:40", java.util.List.of("plex:42", "plex:43"), 2);
        kept.save("plex:40", "Playlist", null, tracks("plex:41"), 2);
        // plex:42 is still on the album: kept. plex:43 is on nothing kept: may go.
        assertEquals(Set.of("plex:43"), kept.deletable());
        assertEquals(1, KeptCollections.trackIds(kept.get("plex:40")).size());
    }

    @Test public void aStaleAnswerIsRecognisedAndCarriesTheServersPlace() throws Exception {
        assertTrue(MediaServiceCapability.stale(new JSONObject().put("response", new JSONObject().put("stale", true).put("seconds", 900))));
        assertEquals(900, MediaServiceCapability.serverSeconds(new JSONObject().put("response", new JSONObject().put("stale", true).put("seconds", 900))));
        assertFalse(MediaServiceCapability.stale(new JSONObject().put("response", new JSONObject().put("ok", true))));
        assertEquals(-1, MediaServiceCapability.serverSeconds(new JSONObject()));
    }
}
