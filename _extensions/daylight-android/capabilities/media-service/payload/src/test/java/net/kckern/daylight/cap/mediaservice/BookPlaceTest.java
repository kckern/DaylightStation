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

public class BookPlaceTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private MediaServiceCapability cap;
    private final FakeMediaApi api = new FakeMediaApi();
    private long now = 1_795_757_000_000L;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new MediaServiceCapability(api, () -> now, x -> { });
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private static JSONObject part(String id, String title, long seconds) throws Exception {
        return new JSONObject().put("contentId", id).put("title", title).put("mediaType", "audio")
                .put("mediaUrl", "/api/v1/proxy/plex/stream/" + id.substring(5)).put("duration", seconds)
                .put("album", "Henry VI Part 3").put("resumable", true);
    }

    private void event(String id, long positionMs, long durationMs, String state) throws Exception {
        cap.call(new JSONObject().put("op", "event").put("id", id).put("title", id).put("positionMs", positionMs)
                .put("durationMs", durationMs).put("state", state));
    }

    private static final String P1 = "plex:727788", P2 = "plex:727789", P3 = "plex:727790", P4 = "plex:727791", P5 = "plex:727792";

    /** Home's queue for the book once part 1 is heard: its watched/unwatched order puts part 1 last. */
    private void homeAnswersLikeTheIncident() throws Exception {
        api.responses.put("queue plex:727787", new JSONObject().put("items", new JSONArray()
                .put(part(P2, "A King in Captivity", 2421)).put(part(P3, "A Battle for the Crown", 1835))
                .put(part(P4, "Betrayal and Desperation", 1788)).put(part(P5, "The Tragic End of a King", 1969))
                .put(part(P1, "War and a Weakening King", 1877))).toString());
        // The book's own listing, in its order.
        JSONArray listed = new JSONArray();
        for (String id : new String[] { P1, P2, P3, P4, P5 }) listed.put(new JSONObject().put("id", id).put("title", id));
        api.responses.put("list plex:727787 5 0", new JSONObject().put("title", "Henry VI Part 3").put("items", listed).toString());
        api.responses.put("recent 100", "{\"items\":[]}");
    }

    private JSONObject resolve(String mediaId) throws Exception {
        return cap.call(new JSONObject().put("op", "resolve").put("ids", new JSONArray().put(mediaId))).body;
    }

    private static String startId(JSONObject r) throws Exception {
        return r.getJSONArray("tracks").getJSONObject(r.getInt("startIndex")).getString("id");
    }

    /**
     * The emulator, 2026-11-26 (build 135): Henry VI Part 3 kept automatically while part 1
     * played, part 1 heard to about a minute and paused, airplane mode, then the book played
     * by a link (media/play?id=plex:727787, which arrives as p:plex:727787). It started at the
     * start of part 2: the leaf named no track of the kept book, so the offline answer fell to
     * index 0, and the kept tracks were in home's queue order (part 1 last, part 2 first).
     */
    @Test public void aBookPlayedOfflineByItsOwnIdResumesWherePartOnePaused() throws Exception {
        homeAnswersLikeTheIncident();
        JSONObject k = cap.call(new JSONObject().put("op", "keep").put("id", "c:plex:727787").put("auto", true)).body;
        assertTrue(k.optBoolean("ok"));
        JSONArray kept = k.getJSONArray("tracks");
        assertEquals("kept in the book's own order", P1, kept.getJSONObject(0).getString("id"));
        assertEquals(P2, kept.getJSONObject(1).getString("id"));
        assertTrue("a book's part is long-form", kept.getJSONObject(0).optBoolean("longForm"));

        for (long s = 0; s <= 60; s += 5) { now += 5000; event(P1, s * 1000, 1_877_000, "playing"); }
        now += 1000;
        event(P1, 60_500, 1_877_000, "paused");

        api.down = true;
        for (String asked : new String[] { "p:plex:727787", "c:plex:727787" }) {
            JSONObject r = resolve(asked);
            assertEquals(asked, P1, startId(r));
            assertEquals(asked, 60_000, r.getLong("startPositionMs"));
        }
    }

    /** Part 1 heard to its end: a whole-book play moves on to part 2, the book's next, from its start. */
    @Test public void aFinishedPartMovesOnToTheBooksNextPart() throws Exception {
        homeAnswersLikeTheIncident();
        cap.call(new JSONObject().put("op", "keep").put("id", "c:plex:727787").put("auto", true));
        now += 10_000;
        event(P1, 1_877_000, 1_877_000, "ended");
        api.down = true;
        JSONObject r = resolve("p:plex:727787");
        assertEquals(P2, startId(r));
        assertEquals(0, r.getLong("startPositionMs"));
    }

    /**
     * Online, the same link: home's play route answers the book with its part in progress
     * and the place; the play starts there, not at the first item of home's queue.
     */
    @Test public void onlineABookByItsOwnIdStartsAtHomesPlace() throws Exception {
        homeAnswersLikeTheIncident();
        api.responses.put("play plex:727787", part(P1, "War and a Weakening King", 1877)
                .put("assetId", P1).put("resume_position", 554).toString());
        JSONObject r = resolve("p:plex:727787");
        assertEquals(P1, startId(r));
        assertEquals(554_000, r.getLong("startPositionMs"));
    }

    /** A queue that starts with a part in progress starts at its place (a song never has one). */
    @Test public void onlineABookContainerStartsAtTheFirstPartsPlace() throws Exception {
        api.responses.put("queue plex:900", new JSONObject().put("items", new JSONArray()
                .put(part("plex:902", "Two", 1800).put("resumePosition", 300)).put(part("plex:903", "Three", 1800))).toString());
        JSONObject r = resolve("c:plex:900");
        assertEquals("plex:902", startId(r));
        assertEquals(300_000, r.getLong("startPositionMs"));
    }

    @Test public void listOrderKeepsUnnamedTracksAfterInHomesOrder() {
        java.util.List<Track> all = new java.util.ArrayList<>();
        for (String id : new String[] { "plex:3", "plex:9", "plex:1", "plex:8", "plex:2" }) all.add(new Track(id, "https://h/" + id, "T", "", "", null, "", 1));
        JSONObject listing = new JSONObject();
        try {
            listing.put("items", new JSONArray().put(new JSONObject().put("id", "plex:1")).put(new JSONObject().put("id", "plex:2"))
                    .put(new JSONObject().put("id", "plex:3")));
        } catch (Exception impossible) { throw new AssertionError(impossible); }
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (Track t : MediaServiceCapability.inListOrder(all, listing)) ids.add(t.id);
        assertEquals(java.util.Arrays.asList("plex:1", "plex:2", "plex:3", "plex:9", "plex:8"), ids);
        assertSame(all, MediaServiceCapability.inListOrder(all, null));
    }
}
