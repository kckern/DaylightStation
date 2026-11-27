package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The payload's group ops (spec §3.11): preview, save, unit keeps, follow, leave and remove. */
public class GroupKeepOpsTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private MediaServiceCapability cap;
    private final FakeMediaApi api = new FakeMediaApi();
    private final long now = 1_795_757_000_000L;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new MediaServiceCapability(api, () -> now, x -> { });
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private static JSONObject part(String id, String album, long seconds) throws Exception {
        return new JSONObject().put("contentId", id).put("title", id).put("mediaType", "audio")
                .put("mediaUrl", "/api/v1/proxy/plex/stream/" + id.substring(5)).put("duration", seconds)
                .put("album", album).put("resumable", true);
    }

    private static JSONObject song(String id, String album) throws Exception {
        JSONObject o = part(id, album, 200);
        o.remove("resumable");
        return o;
    }

    private static JSONObject book(String id, String title, int year) throws Exception {
        return new JSONObject().put("id", id).put("title", title).put("type", "album").put("itemType", "container").put("year", year)
                .put("image", "/api/v1/proxy/plex/library/metadata/" + id.substring(5) + "/thumb/1");
    }

    /** An author of three one-part books; Macbeth started, Hamlet finished. */
    private void author(boolean withOthello) throws Exception {
        JSONArray books = new JSONArray().put(book("plex:10", "Hamlet", 1600)).put(book("plex:20", "Macbeth", 1606))
                .put(book("plex:30", "Lear", 1606));
        if (withOthello) books.put(book("plex:40", "Othello", 1604));
        api.responses.put("list plex:100 100 0", new JSONObject().put("title", "William Shakespeare").put("total", books.length())
                .put("items", books).toString());
        for (String[] b : new String[][] { { "10", "Hamlet" }, { "20", "Macbeth" }, { "30", "Lear" }, { "40", "Othello" } }) {
            api.responses.put("queue plex:" + b[0], new JSONObject().put("items", new JSONArray()
                    .put(part("plex:" + b[0] + "1", b[1], 8000))).toString());
            api.responses.put("list plex:" + b[0] + " 1 0", new JSONObject().put("title", b[1])
                    .put("items", new JSONArray().put(new JSONObject().put("id", "plex:" + b[0] + "1"))).toString());
        }
        api.responses.put("recent 500", new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("contentId", "plex:101").put("playhead", 7990).put("duration", 8000))
                .put(new JSONObject().put("contentId", "plex:201").put("playhead", 300).put("duration", 8000))).toString());
    }

    private JSONObject call(JSONObject request) throws Exception { return cap.call(request).body; }

    private static java.util.List<String> unitIds(JSONObject preview) throws Exception {
        java.util.List<String> out = new java.util.ArrayList<>();
        JSONArray u = preview.getJSONArray("units");
        for (int i = 0; i < u.length(); i++) out.add(u.getJSONObject(i).getString("contentId"));
        return out;
    }

    @Test public void keepAllOnAnAuthorKeepsEachBookAsItsOwnItemUnderTheGroup() throws Exception {
        author(false);
        JSONObject p = call(new JSONObject().put("op", "group-preview").put("id", "c:plex:100").put("kind", "author"));
        assertTrue(p.toString(), p.optBoolean("ok"));
        assertEquals("author", p.getJSONObject("group").getString("kind"));
        assertTrue("keep new ones too: on for an author", p.getJSONObject("group").getBoolean("follow"));
        assertTrue(p.getJSONObject("group").getBoolean("removeFinished"));
        assertEquals("the started book first, then the author's order, finished last",
                java.util.Arrays.asList("plex:20", "plex:30", "plex:10"), unitIds(p));
        assertTrue(p.getJSONArray("units").getJSONObject(2).getBoolean("finished"));
        assertEquals("book", p.getJSONArray("units").getJSONObject(0).getString("kind"));

        // Hamlet (finished) unchecked; the rest chosen.
        JSONObject saved = call(new JSONObject().put("op", "group-save")
                .put("group", p.getJSONObject("group")).put("chosen", new JSONArray().put("plex:20").put("plex:30"))
                .put("listed", new JSONArray(unitIds(p))));
        assertTrue(saved.optBoolean("new"));
        for (String id : new String[] { "plex:20", "plex:30" }) {
            JSONObject k = call(new JSONObject().put("op", "keep").put("id", "c:" + id).put("mode", "keep").put("group", "plex:100"));
            assertEquals("plex:100", k.getString("group"));
            assertEquals("a unit keeps its own nature", "book", k.getString("kind"));
        }
        JSONObject kept = call(new JSONObject().put("op", "kept"));
        assertEquals(2, kept.getJSONArray("items").length());
        assertEquals("plex:100", kept.getJSONArray("items").getJSONObject(0).getString("group"));
        assertEquals(1, kept.getJSONArray("groups").length());

        // A new book at home: the next re-sync names it; the unchecked one stays out.
        author(true);
        JSONObject fresh = call(new JSONObject().put("op", "group-new").put("id", "plex:100"));
        assertEquals(java.util.Collections.singletonList("plex:40"), unitIds(fresh));

        // Remove one unit from the group: the rest stay, and follow does not bring it back.
        JSONObject gone = call(new JSONObject().put("op", "unkeep").put("id", "plex:30").put("from", "group"));
        assertEquals("plex:301", gone.getJSONArray("orphaned").getString(0));
        assertFalse(gone.getBoolean("stays"));
        assertFalse(unitIds(call(new JSONObject().put("op", "group-new").put("id", "plex:100"))).contains("plex:30"));
        assertEquals(1, call(new JSONObject().put("op", "kept")).getJSONArray("items").length());

        // Remove all of the author.
        JSONObject all = call(new JSONObject().put("op", "group-remove").put("id", "plex:100"));
        assertEquals(1, all.getInt("units"));
        assertEquals(0, call(new JSONObject().put("op", "kept")).getJSONArray("items").length());
        assertEquals(0, call(new JSONObject().put("op", "kept")).getJSONArray("groups").length());
    }

    @Test public void anArtistIsNewestFirstAndDoesNotFollowByDefault() throws Exception {
        JSONArray albums = new JSONArray().put(book("plex:10", "Old", 1990)).put(book("plex:20", "New", 2021));
        api.responses.put("list plex:200 100 0", new JSONObject().put("title", "A Band").put("total", 2).put("items", albums).toString());
        api.responses.put("queue plex:10", new JSONObject().put("items", new JSONArray().put(song("plex:11", "Old")).put(song("plex:12", "Old"))).toString());
        api.responses.put("queue plex:20", new JSONObject().put("items", new JSONArray().put(song("plex:21", "New"))).toString());
        api.responses.put("recent 500", "{\"items\":[]}");
        JSONObject p = call(new JSONObject().put("op", "group-preview").put("id", "c:plex:200").put("kind", "artist"));
        assertEquals(java.util.Arrays.asList("plex:20", "plex:10"), unitIds(p));
        assertFalse(p.getJSONObject("group").getBoolean("follow"));
        assertFalse(p.getJSONObject("group").getBoolean("removeFinished"));
        assertEquals("album", p.getJSONArray("units").getJSONObject(0).getString("kind"));
        assertEquals(3, p.getInt("totalTracks"));
        assertEquals(2, p.getInt("withinCap"));
        // A group that does not follow adds nothing at a re-sync.
        call(new JSONObject().put("op", "group-save").put("group", p.getJSONObject("group"))
                .put("chosen", new JSONArray().put("plex:20")).put("listed", new JSONArray(unitIds(p))));
        assertEquals(0, call(new JSONObject().put("op", "group-new").put("id", "plex:200")).getJSONArray("units").length());
    }
}
