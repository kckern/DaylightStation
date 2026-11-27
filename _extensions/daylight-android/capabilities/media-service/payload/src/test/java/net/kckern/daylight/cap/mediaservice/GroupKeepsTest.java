package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Keeping an artist or an author (spec §3.11): units, order, membership, shared copies. */
public class GroupKeepsTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static JSONArray tracks(String... ids) throws Exception {
        JSONArray a = new JSONArray();
        for (String id : ids) a.put(new JSONObject().put("id", id).put("url", "https://h/s/" + id).put("title", id));
        return a;
    }

    private static JSONObject unit(String id, int index, int year, boolean started, boolean finished) throws Exception {
        return new JSONObject().put("contentId", id).put("index", index).put("year", year).put("started", started).put("finished", finished);
    }

    private static List<String> ids(List<JSONObject> units) {
        List<String> out = new ArrayList<>();
        for (JSONObject u : units) out.add(u.optString("contentId"));
        return out;
    }

    @Test public void anAuthorsStartedBookComesFirstThenTheAuthorsOrderFinishedLast() throws Exception {
        List<JSONObject> units = Arrays.asList(unit("plex:1", 0, 1590, false, true), unit("plex:2", 1, 1591, false, false),
                unit("plex:3", 2, 1592, true, false), unit("plex:4", 3, 1593, false, false));
        assertEquals(Arrays.asList("plex:3", "plex:2", "plex:4", "plex:1"), ids(GroupKeeps.ordered(units, GroupKeeps.AUTHOR)));
    }

    @Test public void anArtistsAlbumsAreNewestFirst() throws Exception {
        List<JSONObject> units = Arrays.asList(unit("plex:1", 0, 1999, false, false), unit("plex:2", 1, 2020, false, false),
                unit("plex:3", 2, 2005, false, false), unit("plex:4", 3, 2020, false, false));
        assertEquals(Arrays.asList("plex:2", "plex:4", "plex:3", "plex:1"), ids(GroupKeeps.ordered(units, GroupKeeps.ARTIST)));
    }

    @Test public void theListingsContainersAreTheUnits() throws Exception {
        JSONArray items = new JSONArray()
                .put(new JSONObject().put("id", "plex:10").put("title", "Hamlet").put("type", "album").put("itemType", "container").put("year", 1600))
                .put(new JSONObject().put("id", "plex:11").put("title", "A stray track").put("type", "track").put("itemType", "leaf"))
                .put(new JSONObject().put("id", "plex:10").put("title", "Hamlet again").put("type", "album"))
                .put(new JSONObject().put("id", "plex:12").put("title", "Macbeth").put("type", "album"));
        List<JSONObject> u = GroupKeeps.unitsOf(items);
        assertEquals(Arrays.asList("plex:10", "plex:12"), ids(u));
        assertEquals(1600, u.get(0).getInt("year"));
        assertEquals(1, u.get(1).getInt("index"));
    }

    @Test public void finishedIsTheLastPartAndStartedIsAnyPlace() throws Exception {
        JSONObject p = new JSONObject()
                .put("plex:a2", new JSONObject().put("playhead", 970).put("duration", 1000))
                .put("plex:b1", new JSONObject().put("playhead", 10).put("duration", 1000));
        assertTrue(GroupKeeps.finished(Arrays.asList("plex:a1", "plex:a2"), p));
        assertFalse(GroupKeeps.started(Arrays.asList("plex:a1", "plex:a2"), p));
        assertTrue(GroupKeeps.started(Arrays.asList("plex:b1", "plex:b2"), p));
        assertFalse(GroupKeeps.finished(Arrays.asList("plex:b1", "plex:b2"), p));
        assertFalse(GroupKeeps.started(Arrays.asList("plex:c1"), p));
    }

    @Test public void theCapNeverCutsAUnitInHalf() {
        assertEquals(2, GroupKeeps.withinCap(Arrays.asList(3000, 1500, 600, 10), 5000));
        assertEquals(4, GroupKeeps.withinCap(Arrays.asList(1, 2, 3, 4), 5000));
    }

    @Test public void kindFollowsThePageThenTheUnits() {
        assertEquals(GroupKeeps.AUTHOR, GroupKeeps.groupKind("author", Collections.singletonList("album")));
        assertEquals(GroupKeeps.ARTIST, GroupKeeps.groupKind("artists", Collections.singletonList("book")));
        assertEquals(GroupKeeps.AUTHOR, GroupKeeps.groupKind("", Arrays.asList("album", "book")));
        assertEquals(GroupKeeps.ARTIST, GroupKeeps.groupKind(null, Collections.singletonList("album")));
    }

    @Test public void aReSyncAddsOnlyWhatIsNewAndNotLeftOut() {
        List<String> listed = Arrays.asList("plex:1", "plex:2", "plex:3", "plex:4", "plex:5");
        Set<String> held = new HashSet<>(Arrays.asList("plex:1"));
        Set<String> excluded = new HashSet<>(Arrays.asList("plex:2"));
        Set<String> elsewhere = new HashSet<>(Arrays.asList("plex:3"));
        assertEquals(Arrays.asList("plex:4", "plex:5"), GroupKeeps.newUnits(listed, held, excluded, elsewhere));
        assertEquals(new HashSet<>(Arrays.asList("plex:2", "plex:3")),
                GroupKeeps.excludedAfter(Arrays.asList("plex:2"), Arrays.asList("plex:1", "plex:3"), Arrays.asList("plex:1")));
    }

    // ── membership and shared copies ─────────────────────────────────────────

    private static JSONObject group(String id, boolean follow) throws Exception {
        return new JSONObject().put("id", id).put("title", "Shakespeare").put("kind", "author").put("follow", follow).put("keptAt", 1);
    }

    @Test public void aRemovedUnitLeavesTheRestAndIsLeftOutAfter() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.putGroup(group("plex:100", true));
        kept.saveUnit("plex:10", "Hamlet", null, tracks("plex:11"), 1, "book", "plex:100");
        kept.saveUnit("plex:20", "Macbeth", null, tracks("plex:21"), 1, "book", "plex:100");
        assertEquals(new HashSet<>(Arrays.asList("plex:10", "plex:20")), new HashSet<>(kept.unitsOf("plex:100")));
        assertEquals(Collections.singletonList("plex:11"), kept.leaveGroup("plex:10", 5));
        assertEquals(Collections.singletonList("plex:20"), kept.unitsOf("plex:100"));
        assertTrue("a removed unit is not brought back by follow", KeptCollections.excluded(kept.group("plex:100")).contains("plex:10"));
        // Kept again by hand: no longer left out.
        kept.save("plex:10", "Hamlet", null, tracks("plex:11"), 9);
        assertFalse(KeptCollections.excluded(kept.group("plex:100")).contains("plex:10"));
    }

    @Test public void anAlbumKeptAloneAndThroughItsArtistKeepsItsAudioWhenItLeavesTheGroup() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        // Kept on its own first, then through the artist: one collection, held twice.
        kept.save("plex:10", "Album", null, tracks("plex:11", "plex:12"), 1);
        kept.putGroup(group("plex:100", false));
        kept.saveUnit("plex:10", "Album", null, tracks("plex:11", "plex:12"), 2, "album", "plex:100");
        assertTrue(kept.get("plex:10").optBoolean("alone"));
        assertTrue("leaving the group frees nothing", kept.leaveGroup("plex:10", 3).isEmpty());
        assertEquals("still kept on its own", "plex:10", kept.get("plex:10").getString("contentId"));
        assertEquals("", KeptCollections.groupOf(kept.get("plex:10")));
        assertTrue("no audio may be deleted", kept.deletable().isEmpty());
        // The other order: through the artist first, then by hand.
        kept.saveUnit("plex:20", "Album 2", null, tracks("plex:21"), 4, "album", "plex:100");
        kept.save("plex:20", "Album 2", null, tracks("plex:21"), 5);
        assertTrue(kept.get("plex:20").optBoolean("alone"));
        assertEquals("plex:100", KeptCollections.groupOf(kept.get("plex:20")));
        assertTrue(kept.removeGroup("plex:100", 6).isEmpty());
        assertEquals("the group's removal keeps what is kept on its own", 2, kept.list().size());
        assertEquals(null, kept.group("plex:100"));
    }

    @Test public void aTrackHeldByAKeptPlaylistStaysWhenItsAlbumGoes() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.putGroup(group("plex:100", false));
        kept.saveUnit("plex:10", "Album", null, tracks("plex:11", "plex:12"), 1, "album", "plex:100");
        kept.save("plex:50", "Playlist", null, tracks("plex:12", "plex:51"), 2);
        assertEquals(Collections.singletonList("plex:11"), kept.removeGroup("plex:100", 3));
        assertEquals(Collections.singleton("plex:11"), kept.deletable());
    }

    @Test public void anAutomaticKeepBecomesAManualUnit() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.save("plex:10", "Hamlet", null, tracks("plex:11"), 1, "book", Collections.emptyList());
        assertTrue(KeptCollections.auto(kept.get("plex:10")));
        kept.putGroup(group("plex:100", true));
        kept.saveUnit("plex:10", "Hamlet", null, tracks("plex:11"), 2, "book", "plex:100");
        assertFalse(KeptCollections.auto(kept.get("plex:10")));
        assertFalse("an automatic keep was not kept on its own", kept.get("plex:10").optBoolean("alone"));
    }

    @Test public void membershipSurvivesARefreshAndARestore() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.putGroup(group("plex:100", true));
        kept.saveUnit("plex:10", "Hamlet", null, tracks("plex:11"), 1, "book", "plex:100");
        kept.refreshIfKept("plex:10", "Hamlet", null, tracks("plex:11", "plex:12"), 2, "book");
        assertEquals("plex:100", KeptCollections.groupOf(kept.get("plex:10")));
        JSONArray mirror = new JSONArray().put(kept.get("plex:10"));
        JSONArray groups = new JSONArray().put(kept.group("plex:100"));
        KeptCollections other = new KeptCollections(tmp.newFolder("kept2"));
        assertEquals(1, other.restoreGroups(groups));
        assertEquals(1, other.restore(mirror));
        assertEquals("plex:100", KeptCollections.groupOf(other.get("plex:10")));
        assertEquals(1, other.groups().size());
    }

    @Test public void aUnitRemovedInFullIsLeftOutToo() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.putGroup(group("plex:100", true));
        kept.saveUnit("plex:10", "Hamlet", null, tracks("plex:11"), 1, "book", "plex:100");
        kept.remove("plex:10", 2);
        assertTrue(KeptCollections.excluded(kept.group("plex:100")).contains("plex:10"));
    }

    @Test public void theGroupsFileIsNeverReadAsAKeptCollection() throws Exception {
        KeptCollections kept = new KeptCollections(tmp.newFolder("kept"));
        kept.putGroup(group("plex:100", true));
        assertTrue(kept.list().isEmpty());
        assertTrue(kept.quarantined().isEmpty());
    }
}
