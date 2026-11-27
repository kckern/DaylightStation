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
        assertEquals("must give each tab as Label=target, where a target is recent, continue, catalog, kept or a content id",
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

    @Test public void recentOnlyAdvertisesAudioAndKeepsItsOrder() throws Exception {
        JSONObject response = new JSONObject("{\"items\":["
                + "{\"contentId\":\"plex:1\",\"title\":\"Film\",\"type\":\"movie\"},"
                + "{\"contentId\":\"plex:2\",\"title\":\"Track\",\"type\":\"track\"},"
                + "{\"contentId\":\"plex:3\",\"title\":\"Episode\",\"type\":\"episode\"},"
                + "{\"contentId\":\"plex:4\",\"title\":\"Unknown\"},"
                + "{\"contentId\":\"plex:5\",\"title\":\"Podcast\",\"type\":\"podcast\"}]}");
        List<MediaNode> nodes = BrowseTree.fromRecent(response, backend);
        assertEquals(2, nodes.size());
        assertEquals("p:plex:2", nodes.get(0).id);
        assertEquals("p:plex:5", nodes.get(1).id);
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

    // ── search results (GET /api/v1/content/query/search) ────────────────────

    @Test public void aSearchResultIsAContainerToBrowseOrAnItemWithAStreamToPlay() throws Exception {
        org.json.JSONObject r = new org.json.JSONObject("{\"items\":["
                + "{\"id\":\"plex:100\",\"title\":\"Kind of Blue\",\"itemType\":\"container\",\"thumbnail\":\"/api/v1/display/plex/100\"},"
                + "{\"id\":\"plex:101\",\"title\":\"So What\",\"mediaType\":\"audio\",\"mediaUrl\":\"/api/v1/proxy/plex/101\",\"metadata\":{\"artist\":\"Miles Davis\"}},"
                + "{\"id\":\"plex:102\",\"title\":\"A film\",\"mediaType\":\"video\",\"mediaUrl\":\"/v\"},"
                + "{\"id\":\"immich:9\",\"title\":\"A photo\",\"mediaType\":\"image\",\"mediaUrl\":\"/i\"},"
                + "{\"id\":\"plex:103\",\"title\":\"No stream\"},"
                + "{\"id\":\"https://evil.example/x\",\"title\":\"Bad\",\"itemType\":\"container\"},"
                + "{\"id\":\"plex:104\",\"itemType\":\"container\"},"
                + "{\"id\":\"plex:105\",\"title\":\"Off-site art\",\"itemType\":\"container\",\"thumbnail\":\"https://evil.example/a.jpg\"}"
                + "]}");
        java.util.List<MediaNode> nodes = BrowseTree.fromSearch(r, backend, 50);
        assertEquals(3, nodes.size());
        assertEquals("c:plex:100", nodes.get(0).id);
        assertTrue(nodes.get(0).browsable);
        assertEquals("https://kiosk.example/api/v1/display/plex/100", nodes.get(0).artUrl);
        assertEquals("p:plex:101", nodes.get(1).id);
        assertTrue(nodes.get(1).playable);
        assertEquals("Miles Davis", nodes.get(1).subtitle);
        assertEquals("c:plex:105", nodes.get(2).id);
        assertNull("art on another host is left out", nodes.get(2).artUrl);
    }

    @Test public void searchResultsAreBoundedAndAnAnswerThatIsNotOneIsEmpty() throws Exception {
        StringBuilder many = new StringBuilder("{\"items\":[");
        for (int i = 0; i < 80; i++) many.append(i == 0 ? "" : ",").append("{\"id\":\"plex:").append(i).append("\",\"title\":\"T\",\"itemType\":\"container\"}");
        assertEquals(25, BrowseTree.fromSearch(new org.json.JSONObject(many.append("]}").toString()), backend, 25).size());
        assertTrue(BrowseTree.fromSearch(null, backend, 25).isEmpty());
        assertTrue(BrowseTree.fromSearch(new org.json.JSONObject("{\"items\":5}"), backend, 25).isEmpty());
    }

    @Test public void theBestResultToPlayIsTheFirstEntryAsAnItem() {
        java.util.List<MediaNode> nodes = java.util.Arrays.asList(
                new MediaNode("m:50|plex:9", "More", "", null, true, false),
                new MediaNode("c:plex:100", "Album", "", null, true, false),
                new MediaNode("p:plex:101", "Track", "", null, false, true));
        assertEquals("p:plex:100", BrowseTree.best(nodes));
        assertEquals("p:plex:101", BrowseTree.best(nodes.subList(2, 3)));
        assertNull(BrowseTree.best(java.util.Collections.<MediaNode>emptyList()));
    }

    @Test public void aQueryIsCutTo200CharactersAndLosesItsControlCharacters() {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 250; i++) s.append('\u00e9');
        assertEquals(200, BrowseTree.searchText(s.toString()).length());
        assertEquals("a b c", BrowseTree.searchText(" a\nb\u0000c "));
        assertEquals("", BrowseTree.searchText(null));
        String cut = BrowseTree.searchText(new String(new char[250]).replace("\0", "\uD83C\uDFB5"));
        assertEquals("cut on whole characters", 200, cut.codePointCount(0, cut.length()));
        assertEquals(400, cut.length());
    }

    /** A book's parts point at the book's thumb: not their own art, so a row numbers them. */
    @Test public void aPartWithItsBooksThumbHasNoArtOfItsOwn() throws Exception {
        org.json.JSONObject part = new org.json.JSONObject().put("id", "plex:728065").put("albumId", 728064)
                .put("thumbnail", "/api/v1/proxy/plex/library/metadata/728064/thumb/1791241500");
        assertFalse(BrowseTree.ownArt(part));
        part.put("thumbnail", "/api/v1/proxy/plex/library/metadata/728065/thumb/1791241501");
        assertTrue(BrowseTree.ownArt(part));
        assertFalse(BrowseTree.ownArt(new org.json.JSONObject().put("albumId", 1)));
    }
}
