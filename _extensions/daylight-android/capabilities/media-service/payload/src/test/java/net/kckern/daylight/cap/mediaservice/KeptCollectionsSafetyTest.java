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

    /** Audit 3: a long book's place is never pushed out by songs, and an earlier report never replaces a later one. */
    @Test public void positionsKeepTheBookAndTheNewest() throws Exception {
        File f = new File(tmp.newFolder("pp"), "positions.json");
        PendingProgress p = new PendingProgress(f, id -> id.equals("plex:book"));
        p.keep(new JSONObject().put("assetId", "plex:book").put("seconds", 3000).put("observedAt", 1));
        for (int i = 0; i < PendingProgress.MAX + 5; i++) {
            p.keep(new JSONObject().put("assetId", "plex:song" + i).put("seconds", 10).put("observedAt", 100 + i));
        }
        assertEquals("the kept book is never pushed out", 3000, p.get("plex:book").getLong("seconds"));
        assertEquals("the oldest song goes first", null, p.get("plex:song0"));
        p.keep(new JSONObject().put("assetId", "plex:book").put("seconds", 3600).put("observedAt", 500));
        p.keep(new JSONObject().put("assetId", "plex:book").put("seconds", 10).put("observedAt", 400));
        assertEquals("a report heard earlier never replaces a later one", 3600, p.get("plex:book").getLong("seconds"));
        assertFalse(new File(f.getParentFile(), "positions.json.tmp").exists());
    }

    /** Audit 3: an unreadable positions file is set aside, never overwritten with one entry. */
    @Test public void anUnreadablePositionsFileIsSetAside() throws Exception {
        File dir = tmp.newFolder("pu");
        File f = new File(dir, "positions.json");
        Files.write(f.toPath(), "{trunc".getBytes(StandardCharsets.UTF_8));
        PendingProgress p = new PendingProgress(f);
        p.keep(new JSONObject().put("assetId", "plex:1").put("seconds", 5).put("observedAt", 1));
        boolean aside = false;
        for (String n : dir.list()) if (n.startsWith("positions.json.unreadable-")) aside = true;
        assertTrue(aside);
    }

    /** Audit 4: a re-sync never brings back a collection removed meanwhile. */
    @Test public void aRefreshNeverRevivesARemovedCollection() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kr"));
        kept.save("plex:60", "List", null, tracks("plex:61"), 1);
        kept.remove("plex:60", 2);
        assertFalse(kept.refreshIfKept("plex:60", "List", null, tracks("plex:61", "plex:62"), 3, "playlist"));
        assertEquals(null, kept.get("plex:60"));
        assertTrue(kept.tombstoned("plex:60"));
    }

    /** Audit 5: a quarantined collection comes back from the mirror, and its bad copy goes. */
    @Test public void aQuarantinedCollectionIsRestoredFromTheMirror() throws Exception {
        File dir = tmp.newFolder("kq");
        KeptCollections kept = new KeptCollections(dir);
        kept.save("plex:70", "Album", null, tracks("plex:71"), 1);
        Files.write(new File(dir, "plex_70.json").toPath(), "{bad".getBytes(StandardCharsets.UTF_8));
        assertTrue(kept.list().isEmpty());
        assertEquals(1, kept.quarantined().size());
        JSONArray mirror = new JSONArray().put(new JSONObject().put("contentId", "plex:70").put("title", "Album")
                .put("tracks", tracks("plex:71")).put("keptAt", 1));
        assertEquals(1, kept.restore(mirror));
        assertEquals(0, kept.quarantined().size());
        assertEquals(1, kept.list().size());
    }

    @Test public void aCollectionIsABookAnAlbumOrAPlaylist() {
        assertEquals("book", MediaServiceCapability.kindOf(true, 1, ""));
        assertEquals("book", MediaServiceCapability.kindOf(false, 1, "audiobook"));
        assertEquals("playlist", MediaServiceCapability.kindOf(false, 7, ""));
        assertEquals("playlist", MediaServiceCapability.kindOf(false, 1, "playlist"));
        assertEquals("album", MediaServiceCapability.kindOf(false, 1, "album"));
    }

    @Test public void aBookIsFinishedWhenItsLastPartIsAndAnAlbumNever() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kf"));
        kept.save("plex:80", "Book", null, tracks("plex:81", "plex:82"), 1, "book");
        kept.save("plex:90", "Album", null, tracks("plex:91"), 1, "album");
        JSONObject recent = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("contentId", "plex:82").put("playhead", 980).put("duration", 1000))
                .put(new JSONObject().put("contentId", "plex:91").put("finished", true)));
        JSONArray done = MediaServiceCapability.finishedBooks(kept.list(), recent);
        assertEquals(1, done.length());
        assertEquals("plex:80", done.getString(0));
        recent.getJSONArray("items").getJSONObject(0).put("playhead", 500);
        assertEquals(0, MediaServiceCapability.finishedBooks(kept.list(), recent).length());
    }
}
