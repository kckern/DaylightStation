package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

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

/** "Keep this track" (2026-11-27): a manual keep scoped to one track, which a later "Keep the album" widens. */
public class KeepOneTrackTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private MediaServiceCapability cap;
    private final FakeMediaApi api = new FakeMediaApi();

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new MediaServiceCapability(api, () -> 1_795_757_000_000L, x -> { });
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        api.responses.put("queue plex:500", new JSONObject().put("items", new JSONArray()
                .put(track("plex:501", "Opening")).put(track("plex:502", "Closing"))).toString());
        api.responses.put("list plex:500 1 0", new JSONObject().put("title", "Two Songs").put("items", new JSONArray()).toString());
        // A track's info names its album: the payload keeps within it.
        api.responses.put("info plex:502", new JSONObject().put("metadata", new JSONObject().put("albumId", "500").put("type", "track")).toString());
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private static JSONObject track(String id, String title) throws Exception {
        return new JSONObject().put("contentId", id).put("title", title).put("mediaType", "audio")
                .put("mediaUrl", "/api/v1/proxy/plex/stream/" + id.substring(5)).put("duration", 240).put("album", "Two Songs");
    }

    private JSONObject keep(JSONObject r) throws Exception { return cap.call(r.put("op", "keep")).body; }

    private static int count(JSONObject k) { return k.optJSONArray("tracks") == null ? 0 : k.optJSONArray("tracks").length(); }

    @Test public void keepThisTrackKeepsThatTrackOnlyAndManually() throws Exception {
        JSONObject k = keep(new JSONObject().put("id", "p:plex:502").put("mode", "keep").put("only", new JSONArray().put("plex:502")));
        assertTrue(k.toString(), k.optBoolean("ok"));
        assertEquals("plex:500", k.getString("contentId"));
        assertEquals(1, count(k));
        assertEquals("plex:502", k.getJSONArray("tracks").getJSONObject(0).getString("id"));
        JSONObject saved = cap.kept().get("plex:500");
        assertFalse("a manual keep, never removed by the automatic rules", KeptCollections.auto(saved));
        assertEquals(java.util.Collections.singletonList("plex:502"), KeptCollections.only(saved));
    }

    @Test public void aScopedPreviewSaysOneTrackAndSavesNothing() throws Exception {
        JSONObject p = keep(new JSONObject().put("id", "p:plex:502").put("mode", "preview").put("only", new JSONArray().put("plex:502")));
        assertEquals(1, count(p));
        assertNull(cap.kept().get("plex:500"));
        // The whole keep of the same id right after is not handed the scoped preview.
        JSONObject whole = keep(new JSONObject().put("id", "p:plex:502").put("mode", "keep"));
        assertEquals(2, count(whole));
    }

    @Test public void keepTheAlbumLaterWidensItAndARefreshKeepsTheScope() throws Exception {
        keep(new JSONObject().put("id", "p:plex:502").put("mode", "keep").put("only", new JSONArray().put("plex:502")));
        JSONObject refreshed = keep(new JSONObject().put("id", "c:plex:500").put("mode", "refresh"));
        assertEquals("a refresh keeps the one track", 1, count(refreshed));
        JSONObject album = keep(new JSONObject().put("id", "p:plex:502").put("mode", "keep"));
        assertEquals(2, count(album));
        assertTrue(KeptCollections.only(cap.kept().get("plex:500")).isEmpty());
        // Now kept whole: a later "Keep this track" changes nothing.
        JSONObject again = keep(new JSONObject().put("id", "p:plex:502").put("mode", "keep").put("only", new JSONArray().put("plex:502")));
        assertEquals(2, count(again));
    }
}
