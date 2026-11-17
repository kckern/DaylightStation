package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;

public class BrowseTreeTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private Backend backend;

    @Before public void setUp() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
    }

    @Test public void rootsComeFromTheSettingAndAreAllBrowsable() {
        List<MediaNode> roots = BrowseTree.roots("Recent=recent; Browse=catalog ;Music=plex:5");
        assertEquals(3, roots.size());
        assertEquals("recent", roots.get(0).id);
        assertEquals("Recent", roots.get(0).title);
        assertEquals("catalog", roots.get(1).id);
        assertEquals("c:plex:5", roots.get(2).id);
        for (MediaNode n : roots) { assertTrue(n.browsable); assertFalse(n.playable); }
        assertNull(BrowseTree.rootsProblem("Recent=recent;Browse=catalog"));
    }

    @Test public void rootsAreLimitedToWhatACarShows() {
        assertEquals("must have at most 4 tabs (a car shows no more)", BrowseTree.rootsProblem("A=recent;B=catalog;C=plex:1;D=plex:2;E=plex:3"));
        assertEquals("must name at least one tab, as Label=target", BrowseTree.rootsProblem(""));
        assertEquals("must give each tab as Label=target, where a target is recent, catalog or a content id",
                BrowseTree.rootsProblem("Music=albums"));
        assertNotNull(BrowseTree.rootsProblem("=recent"));
        assertNotNull(BrowseTree.rootsProblem("Music=plex:../x"));
        assertNotNull("a label is short enough for a tab", BrowseTree.rootsProblem("A label far too long for the tab of a car's screen=recent"));
        assertTrue("a setting that cannot be used gives no tabs", BrowseTree.roots("Music=albums").isEmpty());
    }

    /** The list route copies an item's metadata onto the item and sends no metadata object. */
    @Test public void aListResponseMapsContainersAndPlayableLeaves() throws Exception {
        JSONObject response = new JSONObject("{\"total\":3,\"items\":["
                + "{\"id\":\"plex:10\",\"title\":\"Kind of Blue\",\"itemType\":\"container\",\"thumbnail\":\"/api/v1/proxy/plex/thumb/10\","
                + "\"type\":\"album\",\"parentTitle\":\"Miles Davis\",\"list\":{\"contentId\":\"plex:10\",\"plex\":10}},"
                + "{\"id\":\"plex:11\",\"title\":\"So What\",\"itemType\":\"leaf\",\"play\":{\"contentId\":\"plex:11\",\"plex\":11},"
                + "\"type\":\"track\",\"artist\":\"Miles Davis\",\"thumbnail\":null},"
                + "{\"id\":\"app:settings\",\"title\":\"Settings\",\"itemType\":\"leaf\"}]}");
        BrowseTree.Level level = BrowseTree.fromList(response, "plex:9", backend);
        List<MediaNode> nodes = level.nodes;
        assertEquals("an item that is neither a container nor playable is left out", 2, nodes.size());
        assertEquals(3, level.received);
        assertEquals(3, level.total);
        MediaNode album = nodes.get(0);
        assertEquals("c:plex:10", album.id);
        assertTrue(album.browsable);
        assertEquals("Miles Davis", album.subtitle);
        assertEquals("https://kiosk.example/api/v1/proxy/plex/thumb/10", album.artUrl);
        MediaNode track = nodes.get(1);
        assertEquals("the leaf remembers its container so the container can be queued", "p:plex:11|plex:9", track.id);
        assertTrue(track.playable);
        assertNull("a JSON null is not the string \"null\"", track.artUrl);
    }

    /** The list route turns a string of digits into a number, a title among them. */
    @Test public void aTitleThatArrivesAsANumberIsStillATitle() throws Exception {
        JSONObject response = new JSONObject("{\"items\":[{\"id\":\"plex:10\",\"title\":1984,\"itemType\":\"container\"}]}");
        assertEquals("1984", BrowseTree.fromList(response, "plex:9", backend).nodes.get(0).title);
    }

    @Test public void theRootCatalogHasNoParentToRemember() throws Exception {
        JSONObject response = new JSONObject("{\"items\":[{\"id\":\"plex:\",\"title\":\"Plex\",\"itemType\":\"container\"},"
                + "{\"id\":\"plex:audio\",\"title\":\"Music\",\"itemType\":\"container\"}]}");
        BrowseTree.Level level = BrowseTree.fromList(response, null, backend);
        assertEquals("c:plex:", level.nodes.get(0).id);
        assertEquals("c:plex:audio", level.nodes.get(1).id);
        assertEquals("the root answer carries no total", -1, level.total);
    }

    @Test public void whatIsNotWhatTheBackendDocumentsIsLeftOutAndNothingThrows() throws Exception {
        for (String odd : new String[] { "{}", "{\"items\":null}", "{\"items\":\"x\"}", "{\"items\":[null,7,\"x\",{},{\"id\":7},"
                + "{\"id\":\"no-colon\",\"itemType\":\"container\"},{\"id\":\"plex:../x\",\"itemType\":\"container\"},"
                + "{\"id\":\"plex:1|2\",\"itemType\":\"container\"},{\"id\":\"plex:3\",\"itemType\":\"leaf\",\"play\":\"yes\"}]}" }) {
            assertTrue(odd, BrowseTree.fromList(new JSONObject(odd), "plex:9", backend).nodes.isEmpty());
            assertTrue(odd, BrowseTree.fromRecent(new JSONObject(odd), backend).isEmpty());
        }
    }

    @Test public void artIsOnlyEverAnHttpsUrlOnTheBackend() throws Exception {
        JSONObject response = new JSONObject("{\"items\":["
                + "{\"id\":\"youtube:a\",\"title\":\"A\",\"itemType\":\"container\",\"thumbnail\":\"https://i.example.net/a.jpg\"},"
                + "{\"id\":\"retroarch:b\",\"title\":\"B\",\"itemType\":\"container\",\"thumbnail\":\"covers/b.png\"},"
                + "{\"id\":\"plex:c\",\"title\":\"C\",\"itemType\":\"container\",\"thumbnail\":\"//evil.example/c.png\"}]}");
        for (MediaNode n : BrowseTree.fromList(response, null, backend).nodes) assertNull(n.title, n.artUrl);

        CoreRuntime plain = TestCore.create(tmp.newFolder());
        Backend http = Backend.from(plain);
        plain.settings().set(Backend.BASE_URL, "http://192.0.2.10:3111");
        JSONObject one = new JSONObject("{\"items\":[{\"id\":\"plex:1\",\"title\":\"A\",\"itemType\":\"container\",\"thumbnail\":\"/api/v1/t/1\"}]}");
        assertNull("a car is never handed a plain-http image", BrowseTree.fromList(one, null, http).nodes.get(0).artUrl);
    }

    @Test public void recentEntriesArePlayableWithNoParent() throws Exception {
        JSONObject response = new JSONObject("{\"degraded\":false,\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\",\"type\":\"track\","
                + "\"parentTitle\":\"Kind of Blue\",\"grandparentTitle\":\"Miles Davis\",\"thumbnail\":\"/api/v1/proxy/plex/thumb/11\"},"
                + "{\"contentId\":null,\"title\":\"broken\"},"
                + "{\"contentId\":\"plex:12\",\"title\":null}]}");
        List<MediaNode> nodes = BrowseTree.fromRecent(response, backend);
        assertEquals("an entry whose lookup failed has no title and is left out", 1, nodes.size());
        assertEquals("p:plex:11", nodes.get(0).id);
        assertEquals("Miles Davis", nodes.get(0).subtitle);
        assertTrue(nodes.get(0).toJson().getBoolean("playable"));
    }

    @Test public void aLongContainerIsShownAPageAtATimeWithAWayToTheRest() {
        java.util.List<MediaNode> fifty = new java.util.ArrayList<>();
        for (int i = 0; i < 50; i++) fifty.add(new MediaNode("p:plex:" + i + "|plex:9", "Track " + i, "", null, false, true));
        List<MediaNode> first = BrowseTree.paged(new BrowseTree.Level(fifty, 50, 120), "plex:9", 0, 50);
        assertEquals(51, first.size());
        MediaNode more = first.get(50);
        assertEquals("m:50|plex:9", more.id);
        assertEquals("More (51 to 100 of 120)", more.title);
        assertTrue(more.browsable);

        List<MediaNode> last = BrowseTree.paged(new BrowseTree.Level(fifty.subList(0, 20), 20, 120), "plex:9", 100, 50);
        assertEquals("the last page has no way onward", 20, last.size());

        assertEquals("with no total, a full page means there may be more", "m:50|plex:9",
                BrowseTree.paged(new BrowseTree.Level(fifty, 50, -1), "plex:9", 0, 50).get(50).id);
        assertEquals("More", BrowseTree.paged(new BrowseTree.Level(fifty, 50, -1), "plex:9", 0, 50).get(50).title);
        assertEquals("paging stops where a media id can no longer say where it is", 50,
                BrowseTree.paged(new BrowseTree.Level(fifty, 50, 1_000_000), "plex:9", MediaId.MAX_SKIP - 10, 50).size());
        assertEquals("a level never holds more than was asked for", 11,
                BrowseTree.paged(new BrowseTree.Level(fifty, 50, 50), "plex:9", 0, 10).size());
    }
}
