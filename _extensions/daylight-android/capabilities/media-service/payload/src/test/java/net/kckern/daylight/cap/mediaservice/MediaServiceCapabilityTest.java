package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MediaServiceCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private MediaServiceCapability cap;
    private final FakeMediaApi api = new FakeMediaApi();
    private final List<String> launched = new ArrayList<>();
    private long now = 0;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new MediaServiceCapability(api, () -> now, launched::add);
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private JSONObject browse(String parent, int page, int pageSize) throws Exception {
        Map<String, String> q = new HashMap<>();
        q.put("parent", parent);
        q.put("page", String.valueOf(page));
        q.put("pageSize", String.valueOf(pageSize));
        return TestCore.call(core, "GET", "/media/browse", q, null);
    }

    private JSONObject post(String path, String body) throws Exception { return TestCore.call(core, "POST", path, null, body); }

    private LinkHandler mediaLink() {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if ("media".equals(h.kind())) return h;
        throw new AssertionError("no media link handler");
    }

    @Test public void theRootIsTheConfiguredTabs() throws Exception {
        JSONObject r = browse("root", 0, 50);
        assertEquals(200, r.getInt("_status"));
        assertEquals("recent", r.getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("catalog", r.getJSONArray("items").getJSONObject(1).getString("id"));
        assertEquals("the root needs no request", 0, api.calls.size());
    }

    @Test public void aContainerIsAskedForAPageAtATime() throws Exception {
        api.responses.put("list plex:9 50 0", "{\"total\":120,\"items\":[{\"id\":\"plex:10\",\"title\":\"Album\",\"itemType\":\"container\"}]}");
        JSONObject r = browse("c:plex:9", 0, 5000);
        assertEquals("the level size is the setting, whatever the browser asks for", "c:plex:10", r.getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("m:50|plex:9", r.getJSONArray("items").getJSONObject(1).getString("id"));

        api.responses.put("list plex:9 50 50", "{\"total\":120,\"items\":[{\"id\":\"plex:60\",\"title\":\"Later\",\"itemType\":\"container\"}]}");
        assertEquals("c:plex:60", browse("m:50|plex:9", 0, 50).getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("a browser's own second page is empty: a level is one page and a way to the rest",
                0, browse("c:plex:9", 1, 50).getJSONArray("items").length());
    }

    @Test public void theRecentTabAsksForTheConfiguredNumber() throws Exception {
        core.settings().set("media.recentLimit", 12);
        api.responses.put("recent 12", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\",\"type\":\"track\"}]}");
        assertEquals("p:plex:11", browse("recent", 0, 50).getJSONArray("items").getJSONObject(0).getString("id"));
    }

    @Test public void aLevelIsServedFromMemoryWhileItIsFreshAndWhenTheBackendIsOutOfReach() throws Exception {
        api.responses.put("recent 30", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\",\"type\":\"track\"}]}");
        browse("recent", 0, 50);
        browse("recent", 0, 50);
        assertEquals(1, api.calls.size());
        now = 3_600_000;
        api.down = true;
        JSONObject stale = browse("recent", 0, 50);
        assertEquals(200, stale.getInt("_status"));
        assertEquals(1, stale.getJSONArray("items").length());
    }

    @Test public void whenTheBackendIsOutOfReachAndNothingIsKnownBrowseFailsInsteadOfShowingAnEmptyShelf() throws Exception {
        api.down = true;
        JSONObject r = browse("recent", 0, 50);
        assertEquals(502, r.getInt("_status"));
        assertEquals("unreachable", r.getString("error"));
    }

    @Test public void aFailedBrowseSaysWhyHomeDidNotAnswer() throws Exception {
        api.down = true;
        assertEquals("unreachable", browse("recent", 0, 50).getString("reason"));
    }

    @Test public void anOfflineSearchAndLibrarySayWhyAlongsideWhatIsKept() throws Exception {
        api.down = true;
        MediaServiceCapability.Outcome found = cap.call(new JSONObject().put("op", "lookup").put("query", "abbey"));
        assertTrue(found.body.getBoolean("offline"));
        assertEquals("unreachable", found.body.getString("reason"));
        MediaServiceCapability.Outcome library = cap.call(new JSONObject().put("op", "library"));
        assertTrue(library.body.getBoolean("offline"));
        assertEquals("unreachable", library.body.getString("reason"));
    }

    private static String recentWith(String... ids) throws Exception {
        org.json.JSONArray items = new org.json.JSONArray();
        for (String id : ids) items.put(new JSONObject().put("contentId", id).put("title", "Book " + id).put("type", "track")
                .put("playhead", 600).put("duration", 7200));
        return new JSONObject().put("items", items).toString();
    }

    /** Remove from Continue listening: gone at once, sent home, and offline it holds and goes out later. */
    @Test public void aContinueHideHoldsOfflineAndIsSentWhenHomeAnswers() throws Exception {
        api.responses.put("recent 50", recentWith("plex:1", "plex:2"));
        api.down = true;
        MediaServiceCapability.Outcome hid = cap.call(new JSONObject().put("op", "continue-hide").put("contentId", "plex:1").put("hidden", true));
        assertEquals(200, hid.status);
        assertFalse(hid.body.getBoolean("sent"));
        // Home answers the list but not yet the hide: the card stays away here.
        api.down = false;
        api.hideStatus = 503;
        org.json.JSONArray items = cap.call(new JSONObject().put("op", "continue")).body.getJSONArray("items");
        assertEquals(1, items.length());
        assertEquals("plex:2", items.getJSONObject(0).getString("contentId"));
        assertTrue(api.hides.isEmpty());
        // Home takes it; from then on its own list leaves the item out.
        api.hideStatus = 200;
        api.responses.put("recent 50", recentWith("plex:2"));
        assertEquals(1, cap.call(new JSONObject().put("op", "continue")).body.getJSONArray("items").length());
        assertEquals(java.util.Arrays.asList("+plex:1"), api.hides);
        // Undo: a request of its own once home has the hide.
        cap.call(new JSONObject().put("op", "continue-hide").put("contentId", "plex:1").put("hidden", false));
        assertEquals(java.util.Arrays.asList("+plex:1", "-plex:1"), api.hides);
    }

    /** A home without the route keeps the hide waiting on the phone (the card stays gone) until it is updated. */
    @Test public void aHomeWithoutTheHideRouteKeepsItWaiting() throws Exception {
        api.responses.put("recent 50", recentWith("plex:1"));
        api.hideStatus = 404;
        cap.call(new JSONObject().put("op", "continue-hide").put("contentId", "plex:1").put("hidden", true));
        assertEquals(0, cap.call(new JSONObject().put("op", "continue")).body.getJSONArray("items").length());
        api.hideStatus = 200;
        cap.call(new JSONObject().put("op", "continue"));
        assertEquals(java.util.Arrays.asList("+plex:1"), api.hides);
    }

    /** Mark finished from a Continue card marks every part of its book, by the book's id. */
    @Test public void markFinishedFromContinueMarksTheWholeBook() throws Exception {
        api.responses.put("info plex:12", new JSONObject().put("metadata", new JSONObject().put("albumId", "10")).toString());
        api.responses.put("list plex:10 200 0", new JSONObject().put("items", new org.json.JSONArray()
                .put(new JSONObject().put("id", "plex:11").put("itemType", "leaf"))
                .put(new JSONObject().put("id", "plex:12").put("itemType", "leaf"))).toString());
        MediaServiceCapability.Outcome out = cap.call(new JSONObject().put("op", "book-finished").put("contentId", "plex:12"));
        assertEquals(2, out.body.getInt("marked"));
        assertEquals("plex:10", out.body.getString("book"));
        assertEquals(java.util.Arrays.asList("plex:11=true", "plex:12=true"), api.marked);
        assertEquals(java.util.Arrays.asList("+plex:12"), api.hides);
    }

    /** Undo of Mark finished: the parts are not finished again and the card's place is put back. */
    @Test public void undoOfMarkFinishedPutsThePlaceBack() throws Exception {
        api.responses.put("info plex:12", new JSONObject().put("metadata", new JSONObject().put("albumId", "10")).toString());
        api.responses.put("list plex:10 200 0", new JSONObject().put("items", new org.json.JSONArray()
                .put(new JSONObject().put("id", "plex:12").put("itemType", "leaf"))).toString());
        cap.call(new JSONObject().put("op", "book-finished").put("contentId", "plex:12").put("finished", false)
                .put("restoreSeconds", 600).put("durationSeconds", 6000).put("title", "Part"));
        assertEquals(java.util.Arrays.asList("plex:12=false"), api.marked);
        assertEquals(1, api.logged.size());
        assertEquals(600, api.logged.get(0).getLong("seconds"));
        assertEquals("plex:12", api.logged.get(0).getString("assetId"));
    }

    /** The kinds are asked of home; a home without the route falls back to the title rule. */
    @Test public void libraryKindsComeFromHome() throws Exception {
        api.responses.put("audioLibraries", new JSONObject().put("items", new org.json.JSONArray()
                .put(new JSONObject().put("id", "plex:library/sections/9/all").put("title", "Audiobooks").put("kind", "talks"))).toString());
        assertEquals("talks", cap.kinds().of("Audiobooks", "9"));
        assertTrue(cap.kinds().fromHome);
    }

    /** Save as playlist: the content ids go home in order; anything else is dropped. */
    @Test public void saveAsPlaylistSendsTheContentIdsInOrderAndDropsTheRest() throws Exception {
        org.json.JSONArray items = new org.json.JSONArray()
                .put(new JSONObject().put("id", "plex:3").put("title", "Third"))
                .put(new JSONObject().put("id", "javascript:alert(1)"))
                .put(new JSONObject().put("id", "plex:1").put("title", "First"));
        MediaServiceCapability.Outcome made = cap.call(new JSONObject().put("op", "save-playlist")
                .put("title", "Queue 2026-11-26").put("items", items));
        assertEquals(200, made.status);
        assertEquals("menu:queue", made.body.getString("id"));
        org.json.JSONArray sent = api.savedPlaylist.getJSONArray("items");
        assertEquals(2, sent.length());
        assertEquals("plex:3", sent.getJSONObject(0).getString("id"));
        assertEquals("plex:1", sent.getJSONObject(1).getString("id"));
        assertEquals(400, cap.call(new JSONObject().put("op", "save-playlist").put("title", "")
                .put("items", items)).status);
    }

    @Test public void anIdThatIsNotOneOfTheTreesIsRefused() throws Exception {
        assertEquals(400, browse("https://evil.example/", 0, 50).getInt("_status"));
        assertEquals(400, browse("p:plex:11", 0, 50).getInt("_status"));
        assertEquals(0, api.calls.size());
    }

    @Test public void twoQueueEntriesEndingInOneUpdateEachSendOneNaturalReport() throws Exception {
        post("/media/event", "{\"id\":\"plex:11\",\"positionMs\":500,\"durationMs\":500,\"state\":\"ended\"}");
        post("/media/event", "{\"id\":\"plex:12\",\"positionMs\":700,\"durationMs\":700,\"state\":\"transition\"}");
        post("/media/event", "{\"id\":\"plex:12\",\"positionMs\":700,\"durationMs\":700,\"state\":\"ended\"}");

        assertEquals(2, api.logged.size());
        assertEquals("plex:11", api.logged.get(0).getString("assetId"));
        assertEquals("plex:12", api.logged.get(1).getString("assetId"));
        for (JSONObject report : api.logged) {
            assertTrue(report.getBoolean("naturalEnd"));
            assertEquals(0, report.getLong("seconds"));
            assertEquals(100.0, report.getDouble("percent"), 0.001);
        }
    }

    @Test public void eventsBecomePlayLogCalls() throws Exception {
        now = 30_000;
        JSONObject r = post("/media/event", "{\"id\":\"plex:11\",\"title\":\"So What\",\"positionMs\":30000,\"durationMs\":300000,\"state\":\"playing\"}");
        assertEquals(1, r.getInt("reports"));
        assertEquals("plex:11", api.logged.get(0).getString("assetId"));
        assertEquals(30_000, TestCore.get(core, "/media/status").getLong("lastReportAtMs"));
        api.down = true;
        now = 45_000;
        post("/media/event", "{\"id\":\"plex:11\",\"title\":\"So What\",\"positionMs\":45000,\"durationMs\":300000,\"state\":\"playing\"}");
        assertEquals("no connection", TestCore.get(core, "/media/status").getString("lastError"));
        api.down = false;
        api.logStatus = 400;
        now = 60_000;
        post("/media/event", "{\"id\":\"plex:11\",\"title\":\"So What\",\"positionMs\":60000,\"durationMs\":300000,\"state\":\"playing\"}");
        JSONObject status = TestCore.get(core, "/media/status");
        assertEquals("play/log answered 400", status.getString("lastError"));
        assertFalse("what was played is not in the status", status.toString().contains("So What"));
        assertEquals(400, post("/media/event", "{\"title\":\"x\"}").getInt("_status"));
    }

    @Test public void aNowPlayingLinkOpensThePlayerScreenOnACheckedTarget() throws Exception {
        List<String> opened = new ArrayList<>();
        MediaServiceCapability other = new MediaServiceCapability(api, () -> now, new MediaServiceCapability.Launcher() {
            @Override public void play(String mediaId) { fail("not a play"); }
            @Override public void nowPlaying(String target) { opened.add(target); }
        });
        net.kckern.daylight.core.CoreRuntime second = TestCore.create(tmp.newFolder());
        second.add(other);
        second.prepare(new JSONObject());
        second.settings().set(Backend.BASE_URL, "https://kiosk.example");
        LinkHandler link = null;
        for (LinkHandler h : second.services().all(LinkHandler.class)) if ("media".equals(h.kind())) link = h;
        link.handle("now-playing", Collections.<String, String>emptyMap());
        link.handle("now-playing", Collections.singletonMap("target", "local"));
        link.handle("now-playing", Collections.singletonMap("target", "office-tv"));
        assertEquals(Arrays.asList("", "local", "office-tv"), opened);
        for (String bad : new String[] { "Office", "../x", "https://evil.example" }) {
            try { link.handle("now-playing", Collections.singletonMap("target", bad)); fail("accepted " + bad); }
            catch (IllegalArgumentException expected) { }
        }
        other.stop();
    }

    /** A library page by link: media/open?kind=&id= and its alias media/<kind>/<id>; anything else is refused. */
    @Test public void anOpenLinkOpensALibraryPage() throws Exception {
        List<String> opened = new ArrayList<>();
        MediaServiceCapability other = new MediaServiceCapability(api, () -> now, new MediaServiceCapability.Launcher() {
            @Override public void play(String mediaId) { fail("not a play"); }
            @Override public void browse(String mediaId, String kind, String title) { opened.add(kind + " " + mediaId); }
        });
        net.kckern.daylight.core.CoreRuntime second = TestCore.create(tmp.newFolder());
        second.add(other);
        second.prepare(new JSONObject());
        second.settings().set(Backend.BASE_URL, "https://kiosk.example");
        LinkHandler link = null;
        for (LinkHandler h : second.services().all(LinkHandler.class)) if ("media".equals(h.kind())) link = h;
        java.util.Map<String, String> q = new java.util.HashMap<>();
        q.put("kind", "playlist");
        q.put("id", "plex:758161");
        link.handle("open", q);
        link.handle("album/plex:731396", Collections.<String, String>emptyMap());
        assertEquals(Arrays.asList("playlist c:plex:758161", "album c:plex:731396"), opened);
        for (String bad : new String[] { "movie/plex:1", "album/https://evil.example", "open" }) {
            try { link.handle(bad, Collections.<String, String>emptyMap()); fail("accepted " + bad); }
            catch (IllegalArgumentException expected) { }
        }
        other.stop();
    }

    /** The screen ops reach ScreenRemote; a refused command kind is a 400, not a send. */
    @Test public void theScreenOpsAnswerThroughThePort() throws Exception {
        List<String> sent = new ArrayList<>();
        cap.screens = new ScreenRemote(new net.kckern.daylight.core.backend.Http() {
            @Override public Reply get(String url) {
                sent.add("GET " + url);
                return url.endsWith("/config") ? new Reply(200, "{\"devices\":{\"office-tv\":{\"fleet\":true,\"name\":\"Office\"}}}")
                        : new Reply(204, "");
            }
            @Override public Reply postJson(String url, String json) { sent.add("POST " + url); return new Reply(200, "{\"ok\":true}"); }
            @Override public Reply postFile(String url, String type, java.io.File f, Map<String, String> h) { throw new AssertionError(); }
        }, path -> "https://kiosk.example" + path, () -> "Phone");
        assertEquals("Office", cap.call(new JSONObject().put("op", "screens")).body.getJSONArray("items").getJSONObject(0).getString("name"));
        assertEquals(204, cap.call(new JSONObject().put("op", "screen-session").put("device", "office-tv")).body.getInt("status"));
        MediaServiceCapability.Outcome play = cap.call(new JSONObject().put("op", "screen-command").put("device", "office-tv")
                .put("command", "transport").put("action", "play"));
        assertTrue(play.body.getBoolean("accepted"));
        // The shape the installed player sends (ScreenCommands): op is the port's, queueOp the queue's.
        MediaServiceCapability.Outcome clear = cap.call(new JSONObject().put("op", "screen-command").put("device", "office-tv")
                .put("command", "queue").put("queueOp", "clear"));
        assertEquals(200, clear.status);
        assertTrue(clear.body.getBoolean("accepted"));
        assertEquals(400, cap.call(new JSONObject().put("op", "screen-command").put("device", "office-tv").put("command", "system")).status);
        assertEquals(400, cap.call(new JSONObject().put("op", "screen-session").put("device", "../x")).status);
        // device config, the household screen list (browsers open as screens), session, play, clear.
        assertEquals(5, sent.size());
        assertTrue(sent.get(1), sent.get(1).endsWith("/api/v1/media/screens"));
        assertTrue(sent.get(4), sent.get(4).endsWith("/session/queue/clear"));
    }

    @Test public void aKeyedMediaLinkStartsThePlayerWithAContentIdAndNothingElse() throws Exception {
        JSONObject r = mediaLink().handle("play", Collections.singletonMap("id", "plex:11"));
        assertTrue(r.getBoolean("ok"));
        assertEquals("none", r.getString("effect"));
        assertEquals(Collections.singletonList("p:plex:11"), launched);
        for (String bad : new String[] { "https://evil.example/a.mp3", "", "plex:../x", "root", "plex:11|plex:10", "plex:10/shuffle" }) {
            try { mediaLink().handle("play", Collections.singletonMap("id", bad)); fail("accepted " + bad); }
            catch (IllegalArgumentException expected) { }
        }
        try { mediaLink().handle("stop", Collections.singletonMap("id", "plex:11")); fail(); } catch (IllegalArgumentException expected) { }
        try { mediaLink().handle("play", Collections.<String, String>emptyMap()); fail(); } catch (IllegalArgumentException expected) { }
        Map<String, String> withUrl = new HashMap<>();
        withUrl.put("id", "plex:12");
        withUrl.put("url", "https://evil.example/a.mp3");
        mediaLink().handle("play", withUrl);
        assertEquals("only the id is read", "p:plex:12", launched.get(1));
        assertEquals(2, launched.size());
    }

    // ── a tap with no window: the play service asks for an action ─────────────

    private void provideActions(final Map<String, String> media) {
        core.services().provide(net.kckern.daylight.core.spi.ActionList.class, new net.kckern.daylight.core.spi.ActionList() {
            @Override public org.json.JSONArray actions() { return new org.json.JSONArray(); }
            @Override public String mediaContentId(String actionId) { return media.get(actionId); }
        });
    }

    /** The service hands over an action id; the answer is the media id of that action's configured content. */
    @Test public void thePlayServiceGetsTheMediaIdOfAConfiguredMediaActionByItsId() throws Exception {
        Map<String, String> media = new HashMap<>();
        media.put("radio", "plex:12345");
        provideActions(media);
        JSONObject r = cap.call(new JSONObject().put("op", "action").put("action", "radio")).body;
        assertTrue(r.toString(), r.getBoolean("ok"));
        assertEquals("p:plex:12345", r.getString("mediaId"));
    }

    @Test public void anActionThatIsNotAMediaActionOrIsUnknownPlaysNothing() throws Exception {
        Map<String, String> media = new HashMap<>();
        media.put("bad", "https://evil.example/x.mp3");
        provideActions(media);
        assertEquals(404, cap.call(new JSONObject().put("op", "action").put("action", "feed")).status);
        assertEquals("content that is not a content id is refused", 404,
                cap.call(new JSONObject().put("op", "action").put("action", "bad")).status);
        assertEquals(400, cap.call(new JSONObject().put("op", "action").put("action", "plex:12345")).status);
        assertEquals(400, cap.call(new JSONObject().put("op", "action")).status);
    }

    @Test public void withNoActionsInTheBuildAnActionPlaysNothing() throws Exception {
        assertEquals(404, cap.call(new JSONObject().put("op", "action").put("action", "radio")).status);
    }

    // ── pinning media at a page's request ─────────────────────────────────────

    private final List<String> pinnedHere = new ArrayList<>();

    private volatile boolean shortcutsCan;
    private volatile String shortcutsAnswer;
    private boolean shortcutsProvided;

    /** The registry keeps the first provider; later calls change what that one answers. */
    private void provideShortcuts(boolean can, String answerJson) {
        shortcutsCan = can;
        shortcutsAnswer = answerJson;
        if (shortcutsProvided) return;
        shortcutsProvided = true;
        core.services().provide(net.kckern.daylight.core.spi.ShortcutPinner.class, new net.kckern.daylight.core.spi.ShortcutPinner() {
            @Override public boolean canPin() { return shortcutsCan; }
            @Override public JSONObject pinMedia(String contentId, String label) throws Exception {
                pinnedHere.add(contentId + " " + label);
                return new JSONObject(shortcutsAnswer);
            }
        });
    }

    private net.kckern.daylight.core.spi.MediaPinner pinner() {
        net.kckern.daylight.core.spi.MediaPinner p = core.services().find(net.kckern.daylight.core.spi.MediaPinner.class);
        assertNotNull("media-service provides the pinner", p);
        return p;
    }

    @Test public void aCheckedRequestIsHandedToTheShortcutsWithItsLabelTrimmed() throws Exception {
        provideShortcuts(true, "{\"accepted\":true}");
        JSONObject r = pinner().pin("plex:12345", "  Morning music ");
        assertTrue(r.toString(), r.getBoolean("accepted"));
        assertEquals(Collections.singletonList("plex:12345 Morning music"), pinnedHere);
        assertTrue(pinner().canPin());
    }

    @Test public void aBadContentIdOrLabelIsRefusedAndNothingIsPinned() throws Exception {
        provideShortcuts(true, "{\"accepted\":true}");
        assertEquals("invalid_content_id", pinner().pin("https://evil.example/x", "Label").getString("reason"));
        assertEquals("invalid_content_id", pinner().pin("plex:../x", "Label").getString("reason"));
        assertEquals("invalid_content_id", pinner().pin("plex:1/shuffle", "Label").getString("reason"));
        assertEquals("invalid_label", pinner().pin("plex:1", "‮evil").getString("reason"));
        assertEquals("invalid_label", pinner().pin("plex:1", "").getString("reason"));
        assertFalse(pinner().pin("plex:1", null).getBoolean("accepted"));
        assertTrue(pinnedHere.isEmpty());
    }

    @Test public void withoutShortcutsOrALauncherThatPinsNothingCanBePinned() throws Exception {
        assertFalse(pinner().canPin());
        JSONObject r = pinner().pin("plex:1", "Radio");
        assertFalse(r.getBoolean("accepted"));
        assertEquals("not_available", r.getString("reason"));
        provideShortcuts(false, "{\"accepted\":true}");
        assertFalse(pinner().canPin());
    }

    /** Whatever the shortcuts answer, only accepted and a reason go back toward the page. */
    @Test public void theAnswerHoldsAcceptedAndAReasonAndNothingElse() throws Exception {
        provideShortcuts(true, "{\"accepted\":false,\"reason\":\"launcher_refused\",\"uri\":\"daylight://action/x#k=SECRET\",\"id\":\"media-1\"}");
        JSONObject r = pinner().pin("plex:1", "Radio");
        assertEquals(2, r.length());
        assertFalse(r.getBoolean("accepted"));
        assertEquals("launcher_refused", r.getString("reason"));
        provideShortcuts(true, "{\"accepted\":true,\"uri\":\"daylight://action/x#k=SECRET\"}");
        assertEquals("{\"accepted\":true}", pinner().pin("plex:1", "Radio").toString());
    }

    // ── search (a car's voice search) ─────────────────────────────────────────

    private static final String RESULTS = "{\"items\":["
            + "{\"id\":\"plex:100\",\"title\":\"Kind of Blue\",\"itemType\":\"container\",\"thumbnail\":\"/api/v1/display/plex/100\"},"
            + "{\"id\":\"plex:101\",\"title\":\"So What\",\"mediaType\":\"audio\",\"mediaUrl\":\"/api/v1/proxy/plex/101\",\"metadata\":{\"artist\":\"Miles Davis\"}}"
            + "]}";

    private JSONObject search(String query) throws Exception {
        return cap.call(new JSONObject().put("op", "search").put("query", query)).body;
    }

    @Test public void aSearchAsksTheBackendAndAnswersWithBrowseEntriesAndTheBestToPlay() throws Exception {
        api.responses.put("search miles 50", RESULTS);
        JSONObject r = search("miles");
        assertTrue(r.toString(), r.getBoolean("ok"));
        assertEquals("c:plex:100", r.getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("p:plex:101", r.getJSONArray("items").getJSONObject(1).getString("id"));
        assertEquals("the first result plays; a container plays from its first item", "p:plex:100", r.getString("best"));
    }

    @Test public void theQueryIsCutTo200CharactersAndIsNeverNoted() throws Exception {
        StringBuilder longQuery = new StringBuilder();
        for (int i = 0; i < 300; i++) longQuery.append('a');
        String cut = longQuery.substring(0, 200);
        api.responses.put("search " + cut + " 50", RESULTS);
        assertTrue(search(longQuery.toString()).getBoolean("ok"));
        api.responses.put("search secret words 50", RESULTS);
        search("secret\nwords");
        assertTrue(api.calls.contains("search secret words 50"));
        for (String n : ((net.kckern.daylight.core.testing.FakeShell) core.shell()).notes) assertFalse(n, n.contains("secret"));
    }

    @Test public void anEmptyQueryAnswersTheRecentList() throws Exception {
        api.responses.put("recent 30", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\",\"type\":\"track\"}]}");
        JSONObject r = search("  ");
        assertEquals("p:plex:11", r.getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("p:plex:11", r.getString("best"));
        assertFalse(api.calls.toString().contains("search"));
    }

    @Test public void theAnswerIsBoundedByThePageSizeAndASearchWithNoResultHasNoBest() throws Exception {
        core.settings().set("media.pageSize", 10);
        StringBuilder many = new StringBuilder("{\"items\":[");
        for (int i = 0; i < 40; i++) many.append(i == 0 ? "" : ",").append("{\"id\":\"plex:").append(i).append("\",\"title\":\"T\",\"itemType\":\"container\"}");
        api.responses.put("search x 10", many.append("]}").toString());
        assertEquals(10, search("x").getJSONArray("items").length());
        api.responses.put("search none 10", "{\"items\":[]}");
        JSONObject r = search("none");
        assertEquals(0, r.getJSONArray("items").length());
        assertFalse(r.has("best"));
    }

    @Test public void aBackendThatCannotSearchIsAFailureNotAnEmptyAnswer() throws Exception {
        assertEquals(404, cap.call(new JSONObject().put("op", "search").put("query", "x")).status);
        api.down = true;
        assertEquals(502, cap.call(new JSONObject().put("op", "search").put("query", "y")).status);
        assertEquals(400, cap.call(new JSONObject().put("op", "search").put("query", 5)).status);
    }

    @Test public void resolveAnswersWithTracksAndWhereToStart() throws Exception {
        api.responses.put("queue plex:10", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/11\",\"duration\":100}]}");
        JSONObject r = post("/media/resolve", "{\"ids\":[\"c:plex:10\"]}");
        assertEquals("https://kiosk.example/s/11", r.getJSONArray("tracks").getJSONObject(0).getString("url"));
        assertEquals(0, r.getInt("startIndex"));
        assertEquals(400, post("/media/resolve", "{\"ids\":[]}").getInt("_status"));
        assertEquals(400, post("/media/resolve", "{\"ids\":[\"https://evil.example/a.mp3\"]}").getInt("_status"));
        assertEquals("an id the backend does not have", 404, post("/media/resolve", "{\"ids\":[\"p:plex:404\"]}").getInt("_status"));
    }

    @Test public void onlyTheSelectedPlayResponseSuppressesItsServerResume() throws Exception {
        String proxied = "/api/v1/proxy/plex/stream/99?session=fixture";
        String signed = "/s/11?offset=7&signature=fixture%2Bvalue";
        api.responses.put("play plex:99", "{\"id\":\"plex:99\",\"mediaType\":\"audio\",\"mediaUrl\":\"" + proxied
                + "&offset=30\",\"duration\":100,\"resumable\":true,\"resume_position\":30}");
        api.responses.put("play plex:99?resume=false",
                "{\"id\":\"plex:99\",\"mediaType\":\"audio\",\"mediaUrl\":\"" + proxied + "\"}");
        api.responses.put("play plex:11", "{\"id\":\"plex:11\",\"mediaType\":\"audio\",\"mediaUrl\":\"" + signed + "\"}");
        api.responses.put("queue plex:20", "{\"items\":[]}");

        JSONObject saved = post("/media/resolve", "{\"ids\":[\"p:plex:99\"]}");
        // The phone seeks itself: the server-side offset is dropped, the position kept.
        assertEquals("https://kiosk.example" + proxied, saved.getJSONArray("tracks").getJSONObject(0).getString("url"));
        assertEquals(30_000, saved.getLong("startPositionMs"));

        JSONObject explicit = post("/media/resolve",
                "{\"ids\":[\"p:plex:11\",\"p:plex:99\"],\"startIndex\":1,\"explicitPosition\":true}");
        assertEquals("https://kiosk.example" + signed, explicit.getJSONArray("tracks").getJSONObject(0).getString("url"));
        assertEquals("https://kiosk.example" + proxied, explicit.getJSONArray("tracks").getJSONObject(1).getString("url"));
        assertTrue(explicit.getBoolean("selectionResolved"));

        JSONObject explicitDefault = post("/media/resolve",
                "{\"ids\":[\"p:plex:99\"],\"explicitPosition\":true}");
        assertTrue(explicitDefault.getBoolean("selectionResolved"));
        assertEquals("https://kiosk.example" + proxied,
                explicitDefault.getJSONArray("tracks").getJSONObject(0).getString("url"));

        JSONObject fallback = post("/media/resolve",
                "{\"ids\":[\"c:plex:20\",\"p:plex:99\"],\"startIndex\":0,\"explicitPosition\":true}");
        assertEquals("https://kiosk.example" + proxied,
                fallback.getJSONArray("tracks").getJSONObject(0).getString("url"));
        assertFalse(fallback.getBoolean("selectionResolved"));
    }

    @Test public void daylightListsUseTheSameQueueForWidgetAndCarPlayback() throws Exception {
        api.responses.put("audioSources", "{\"items\":[{\"id\":\"program:\",\"title\":\"Programs\"}]}");
        api.responses.put("audioLists program: 0", new JSONObject().put("nextCursor", 4)
                .put("items", new org.json.JSONArray().put(new JSONObject()
                        .put("id", "program:music-queue").put("title", "Music Queue"))).toString());
        api.responses.put("queue program:music-queue", new JSONObject().put("items",
                new org.json.JSONArray().put(new JSONObject().put("id", "files:episode")
                        .put("title", "Episode").put("mediaType", "audio")
                        .put("mediaUrl", "/api/v1/proxy/media/stream/episode?stream=audio"))).toString());

        JSONObject picker = cap.call(new JSONObject().put("op", "playlists").put("source", "program:")).body;
        String list = picker.getJSONArray("items").getJSONObject(0).getString("contentId");
        assertEquals("program:music-queue", list);
        assertEquals(4, picker.getInt("nextCursor"));

        assertEquals("s:0|program:", browse("c:audio-lists:", 0, 50)
                .getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("s:4|program:", browse("s:0|program:", 0, 50)
                .getJSONArray("items").getJSONObject(1).getString("id"));
        String leaf = browse("a:0|" + list, 0, 50).getJSONArray("items").getJSONObject(0).getString("id");
        assertEquals("p:files:episode|program:music-queue", leaf);

        JSONObject widget = cap.call(new JSONObject().put("op", "resolve")
                .put("ids", new org.json.JSONArray().put("c:" + list))).body;
        JSONObject car = cap.call(new JSONObject().put("op", "resolve")
                .put("ids", new org.json.JSONArray().put(leaf))).body;
        assertTrue(widget.getBoolean("ok"));
        assertTrue(car.getBoolean("ok"));
        assertEquals(widget.getJSONArray("tracks").toString(), car.getJSONArray("tracks").toString());
    }

    @Test public void playlistPickerConsumesProviderNeutralPages() throws Exception {
        api.responses.put("audioLists library:mixes 0",
                new JSONObject().put("nextCursor", 4).put("items", new org.json.JSONArray()
                        .put(new JSONObject().put("id", "library:11").put("title", "Mix")
                                .put("thumbnail", "/api/v1/display/library/11"))).toString());
        api.responses.put("audioLists library:mixes 4",
                new JSONObject().put("items", new org.json.JSONArray()
                        .put(new JSONObject().put("id", "library:12").put("title", "Other"))).toString());
        JSONObject request = new JSONObject().put("op", "playlists").put("source", "library:mixes");
        JSONObject first = cap.call(request).body;
        assertTrue(first.getBoolean("ok"));
        assertEquals("library:11", first.getJSONArray("items").getJSONObject(0).getString("contentId"));
        JSONObject next = cap.call(request.put("cursor", first.getInt("nextCursor"))).body;
        assertEquals("library:12", next.getJSONArray("items").getJSONObject(0).getString("contentId"));
        assertFalse(next.has("nextCursor"));
    }

    @Test public void theInstalledServiceAsksOverThePortAndGetsTheSameAnswers() throws Exception {
        PayloadPort port = PayloadPort.named(MediaServiceCapability.PORT);
        assertFalse(port.ready());
        cap.start();
        assertTrue(port.ready());
        JSONObject root = new JSONObject(port.call("{\"op\":\"browse\",\"parent\":\"root\",\"page\":0,\"pageSize\":50}", 0));
        assertTrue(root.getBoolean("ok"));
        assertEquals("recent", root.getJSONArray("items").getJSONObject(0).getString("id"));

        api.responses.put("queue plex:10", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/11\",\"duration\":100}]}");
        JSONObject resolved = new JSONObject(port.call("{\"op\":\"resolve\",\"ids\":[\"c:plex:10\"]}", 0));
        assertEquals("plex:11", resolved.getJSONArray("tracks").getJSONObject(0).getString("id"));

        api.responses.put("play plex:99", "{\"id\":\"plex:99\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/99\"}");
        JSONObject selected = new JSONObject(port.call(
                "{\"op\":\"resolve\",\"ids\":[\"c:plex:10\",\"p:plex:99\"],\"startIndex\":1}", 0));
        assertEquals(1, selected.getInt("startIndex"));
        assertEquals("plex:99", selected.getJSONArray("tracks").getJSONObject(1).getString("id"));
        assertTrue(selected.getBoolean("selectionResolved"));

        api.responses.put("queue plex:20", "{\"items\":[]}");
        JSONObject emptySelection = new JSONObject(port.call(
                "{\"op\":\"resolve\",\"ids\":[\"c:plex:20\",\"p:plex:99\"],\"startIndex\":0}", 0));
        assertEquals(0, emptySelection.getInt("startIndex"));
        assertEquals("plex:99", emptySelection.getJSONArray("tracks").getJSONObject(0).getString("id"));
        assertFalse(emptySelection.getBoolean("selectionResolved"));

        JSONObject refused = new JSONObject(port.call("{\"op\":\"resolve\",\"ids\":[\"x\"]}", 0));
        assertFalse(refused.getBoolean("ok"));
        assertEquals("bad_request", refused.getString("error"));
        assertFalse(new JSONObject(port.call("{\"op\":\"erase\"}", 0)).getBoolean("ok"));
        assertFalse(new JSONObject(port.call("not json", 0)).getBoolean("ok"));

        now = 30_000;
        JSONObject event = new JSONObject(port.call("{\"op\":\"event\",\"id\":\"plex:11\",\"title\":\"One\",\"positionMs\":30000,\"durationMs\":300000,\"state\":\"playing\"}", 0));
        assertEquals(1, event.getInt("reports"));
        long deadline = System.currentTimeMillis() + 5000;
        while (api.logged.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertEquals("the report is sent off the caller's thread", 1, api.logged.size());
    }

    @Test public void startTakesAWorkerAndThePortAndStopGivesBothBack() throws Exception {
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), new FakeContext(tmp.newFolder()));
        MediaServiceCapability started = new MediaServiceCapability();
        real.add(started);
        real.prepare(new JSONObject());
        PayloadPort port = PayloadPort.named(MediaServiceCapability.PORT);
        assertFalse(port.ready());
        assertEquals(0, FakeContext.liveThreads(MediaServiceCapability.WORKER));
        started.start();
        try {
            assertTrue(port.ready());
            // The worker thread exists from its first job.
            port.call("{\"op\":\"event\",\"id\":\"plex:11\",\"title\":\"\",\"positionMs\":30000,\"durationMs\":300000,\"state\":\"playing\"}", 0);
            long deadline = System.currentTimeMillis() + 5000;
            while (FakeContext.liveThreads(MediaServiceCapability.WORKER) == 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertEquals(1, FakeContext.liveThreads(MediaServiceCapability.WORKER));
        } finally {
            started.stop();
        }
        assertFalse(port.ready());
        long deadline = System.currentTimeMillis() + 5000;
        while (FakeContext.liveThreads(MediaServiceCapability.WORKER) > 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertEquals(0, FakeContext.liveThreads(MediaServiceCapability.WORKER));
        started.stop();
    }

    @Test public void aStoppedPayloadDoesNotTakeThePortFromItsSuccessor() throws Exception {
        cap.start();
        MediaServiceCapability next = new MediaServiceCapability(api, () -> now, launched::add);
        CoreRuntime other = TestCore.create(tmp.newFolder());
        other.add(next);
        other.prepare(new JSONObject());
        next.start();
        cap.stop();
        assertTrue("the successor's handler is still attached", PayloadPort.named(MediaServiceCapability.PORT).ready());
        next.stop();
        assertFalse(PayloadPort.named(MediaServiceCapability.PORT).ready());
    }

    @Test public void aBadTabSettingIsAProblemInTheStatusAndStartStillRuns() throws Exception {
        assertEquals(0, TestCore.get(core, "/media/status").getJSONArray("problems").length());
        try { core.settings().set("media.roots", "Music=albums"); fail("the rule lets a bad value through"); }
        catch (RuntimeException expected) { assertTrue(expected.getMessage().contains("setting 'media.roots' must give each tab")); }
        try { core.settings().set("media.recentLimit", 0); fail(); } catch (RuntimeException expected) { }
        try { core.settings().set("media.pageSize", 5000); fail(); } catch (RuntimeException expected) { }
        cap.start();
    }

    @Test public void withNoBackendConfiguredTheStatusSaysSoAndBrowseFails() throws Exception {
        core.settings().set(Backend.BASE_URL, "");
        assertEquals("the household site is not set", TestCore.get(core, "/media/status").getJSONArray("problems").getString(0));
    }

    @Test public void withNoAndroidContextAMediaLinkSaysItIsNotAvailable() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        MediaServiceCapability plain = new MediaServiceCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        LinkHandler link = null;
        for (LinkHandler h : bare.services().all(LinkHandler.class)) if ("media".equals(h.kind())) link = h;
        JSONObject r = link.handle("play", Collections.singletonMap("id", "plex:11"));
        assertEquals("toast", r.getString("effect"));
    }

    // ── the pins of the controllers that may connect ─────────────────────────

    @Test public void noControllerIsPinnedUnlessTheDeviceSaysSo() {
        assertEquals("", core.settings().get("media.controllerPins"));
        try {
            core.settings().set("media.controllerPins", "com.example.app=notahash");
            fail("accepted a pin that is not a digest");
        } catch (RuntimeException expected) { }
    }

    @Test public void thePinsAreHandedToTheInstalledServiceAtStartAndWhenTheyChange() throws Exception {
        final List<String> written = new ArrayList<>();
        cap.pinCache = written::add;
        cap.start();
        assertEquals("[{}]", written.toString());
        String cert = "ab".repeat(32);
        core.settings().set("media.controllerPins", "com.example.car=" + cert);
        assertEquals(2, written.size());
        assertEquals(cert, new JSONObject(written.get(1)).getString("com.example.car"));
    }

    @Test public void trackLevelsAndLyricsPassThroughAndNoneIsNotAnError() throws Exception {
        api.responses.put("levels plex:7 64", "{\"samples\":[0.5,1],\"quality\":{\"codec\":\"flac\"}}");
        JSONObject levels = cap.call(new JSONObject().put("op", "track-levels").put("id", "plex:7").put("samples", 64)).body;
        assertEquals("flac", levels.getJSONObject("levels").getJSONObject("quality").getString("codec"));
        api.responses.put("lyrics plex:7", "none");
        assertTrue(cap.call(new JSONObject().put("op", "track-lyrics").put("id", "plex:7")).body.getBoolean("none"));
        // An older backend without the route answers 404: the same as none.
        assertTrue(cap.call(new JSONObject().put("op", "track-lyrics").put("id", "plex:8")).body.getBoolean("none"));
        assertEquals(400, cap.call(new JSONObject().put("op", "track-lyrics").put("id", "../etc")).status);
        // samples are clamped to 16..400
        cap.call(new JSONObject().put("op", "track-levels").put("id", "plex:9").put("samples", 5000));
        assertTrue(api.calls.contains("levels plex:9 400"));
    }

    /** Chapters pass through; none and an older backend are none; without home, the ones seen this session answer. */
    @Test public void trackChaptersPassThroughAndAnswerOfflineFromWhatWasSeen() throws Exception {
        api.responses.put("chapters plex:731397", "{\"chapters\":[{\"startMs\":0,\"endMs\":1000,\"title\":\"Chapter 1\"},"
                + "{\"startMs\":1000,\"endMs\":2000,\"title\":\"Chapter 2\"}],\"durationMs\":2000,\"provider\":\"audiobookshelf\"}");
        JSONObject got = cap.call(new JSONObject().put("op", "track-chapters").put("id", "plex:731397")).body;
        assertEquals(2, got.getJSONObject("chapters").getJSONArray("chapters").length());
        api.responses.put("chapters plex:1", "none");
        assertTrue(cap.call(new JSONObject().put("op", "track-chapters").put("id", "plex:1")).body.getBoolean("none"));
        assertTrue(cap.call(new JSONObject().put("op", "track-chapters").put("id", "plex:2")).body.getBoolean("none")); // 404
        assertEquals(400, cap.call(new JSONObject().put("op", "track-chapters").put("id", "../x")).status);
        api.down = true;
        JSONObject offline = cap.call(new JSONObject().put("op", "track-chapters").put("id", "plex:731397")).body;
        assertEquals("audiobookshelf", offline.getJSONObject("chapters").getString("provider"));
        assertTrue(cap.call(new JSONObject().put("op", "track-chapters").put("id", "plex:3")).body.getBoolean("none"));
    }

    /** Continue listening: long audio started and not finished, newest first; songs, video and finished items stay out. */
    @Test public void continueListsLongAudioInProgress() throws Exception {
        api.responses.put("recent 50", "{\"items\":["
                + "{\"contentId\":\"plex:727120\",\"title\":\"A book\",\"type\":\"track\",\"playhead\":178,\"duration\":17800,\"parentTitle\":\"The book\"},"
                + "{\"contentId\":\"plex:352337\",\"title\":\"A song\",\"type\":\"track\",\"playhead\":24,\"duration\":64},"
                + "{\"contentId\":\"plex:775444\",\"title\":\"A film\",\"type\":\"movie\",\"playhead\":62,\"duration\":5636},"
                + "{\"contentId\":\"plex:377395\",\"title\":\"A lecture\",\"type\":\"track\",\"playhead\":4600,\"duration\":4636},"
                + "{\"contentId\":\"plex:1\",\"title\":\"Barely begun\",\"type\":\"track\",\"playhead\":5,\"duration\":4000},"
                + "{\"contentId\":\"plex:2\",\"title\":\"A talk\",\"type\":\"track\",\"playhead\":900,\"duration\":3000},"
                + "{\"contentId\":\"plex:727120\",\"title\":\"A book\",\"type\":\"track\",\"playhead\":10,\"duration\":17800}]}");
        JSONObject reply = cap.call(new JSONObject().put("op", "continue")).body;
        org.json.JSONArray items = reply.getJSONArray("items");
        assertEquals(2, items.length());
        assertEquals("plex:727120", items.getJSONObject(0).getString("contentId"));
        assertEquals("p:plex:727120", items.getJSONObject(0).getString("id"));
        assertEquals(178, items.getJSONObject(0).getLong("playhead"));
        assertEquals("The book", items.getJSONObject(0).getString("subtitle"));
        assertEquals("plex:2", items.getJSONObject(1).getString("contentId"));
    }

    /** The car's Continue tab: books and talks in progress, then the lists played lately. */
    @Test public void continueTabHoldsProgressThenRecentLists() throws Exception {
        assertNull(BrowseTree.rootsProblem("Drive=drive:;Continue=continue;Recent=recent"));
        api.responses.put("recent 50", "{\"items\":[{\"contentId\":\"plex:727120\",\"title\":\"A book\",\"type\":\"track\",\"playhead\":178,\"duration\":17800}]}");
        org.json.JSONArray lists = new org.json.JSONArray()
                .put(new JSONObject().put("contentId", "plex:900").put("title", "80s radio"))
                .put(new JSONObject().put("contentId", "plex:900").put("title", "80s radio (again)"));
        java.util.List<MediaNode> nodes = BrowseTree.continueNodes(BrowseTree.continueItems(api.recent(50), null, 8), lists);
        assertEquals(2, nodes.size());
        assertEquals("p:plex:727120", nodes.get(0).toJson().getString("id"));
        assertTrue(nodes.get(0).toJson().getString("subtitle").startsWith("4 h 53 min left"));
        assertEquals("c:plex:900", nodes.get(1).toJson().getString("id"));
        assertTrue(nodes.get(1).toJson().getBoolean("playable"));
    }

    @Test public void recentListsKeepTheNewestFirstOnce() throws Exception {
        java.io.File dir = java.nio.file.Files.createTempDirectory("rl").toFile();
        RecentLists lists = new RecentLists(new java.io.File(dir, "recent-lists.json"));
        lists.record("plex:1", "One", null, 1);
        lists.record("plex:2", "Two", "https://x/a.jpg", 2);
        lists.record("plex:1", "One", null, 3);
        assertEquals(2, lists.list().length());
        assertEquals("plex:1", lists.list().getJSONObject(0).getString("contentId"));
        for (int i = 0; i < 20; i++) lists.record("plex:" + (10 + i), "L" + i, null, 10 + i);
        assertEquals(RecentLists.MAX, lists.list().length());
        lists.record("../etc", "bad", null, 99);
        assertEquals("plex:29", lists.list().getJSONObject(0).getString("contentId"));
    }

    private static String continueAnswer(int review, String... rows) {
        StringBuilder b = new StringBuilder("{\"items\":[");
        for (int i = 0; i < rows.length; i++) b.append(i == 0 ? "" : ",").append(rows[i]);
        return b.append("],\"reviewCount\":").append(review).append(",\"minListenedMin\":5}").toString();
    }

    /** §13: home's one answer, one row per book: the book to act on, the part to resume, the part's place in the book. */
    @Test public void continueReadsHomesOneAnswerOneRowPerBook() throws Exception {
        api.responses.put("continue 10", continueAnswer(2,
                "{\"contentId\":\"plex:500\",\"playContentId\":\"plex:502\",\"title\":\"Henry VI Part 3\",\"byline\":\"William Shakespeare\","
                        + "\"partTitle\":\"War and a Weakening King\",\"partIndex\":2,\"partCount\":5,\"playhead\":600,\"duration\":1500,"
                        + "\"remainingSec\":5400,\"listenedSec\":900,\"legacy\":false}",
                "{\"contentId\":\"plex:600\",\"playContentId\":\"plex:600\",\"title\":\"Snakes\",\"byline\":null,"
                        + "\"playhead\":300,\"duration\":3000,\"remainingSec\":2700,\"legacy\":true}"));
        JSONObject reply = cap.call(new JSONObject().put("op", "continue").put("limit", 6)).body;
        org.json.JSONArray items = reply.getJSONArray("items");
        assertEquals(2, reply.getInt("reviewCount"));
        assertEquals(2, items.length());
        JSONObject book = items.getJSONObject(0);
        assertEquals("plex:500", book.getString("contentId"));
        assertEquals("p:plex:502", book.getString("id"));
        assertEquals("Henry VI Part 3", book.getString("title"));
        assertEquals("William Shakespeare", book.getString("subtitle"));
        assertEquals("Part 2 of 5 · 1 h 30 min left", BrowseTree.continueLine(book));
        assertTrue(items.getJSONObject(1).getBoolean("legacy"));
        assertEquals("45 min left", BrowseTree.continueLine(items.getJSONObject(1)));
    }

    /** A home older than the route: the old way, from its recent list. */
    @Test public void continueFallsBackToRecentOnAnOlderHome() throws Exception {
        api.responses.put("recent 50", recentWith("plex:1"));
        org.json.JSONArray items = cap.call(new JSONObject().put("op", "continue").put("limit", 6)).body.getJSONArray("items");
        assertEquals(1, items.length());
        assertEquals("plex:1", items.getJSONObject(0).getString("contentId"));
    }

    /** The one-time review of older entries: listed, then kept or cleared one by one or all at once. */
    @Test public void olderEntriesAreReviewedKeptOrCleared() throws Exception {
        api.responses.put("continueReview", continueAnswer(1,
                "{\"contentId\":\"plex:600\",\"playContentId\":\"plex:600\",\"title\":\"Snakes\",\"playhead\":300,\"duration\":3000,\"legacy\":true}"));
        org.json.JSONArray items = cap.call(new JSONObject().put("op", "continue-review")).body.getJSONArray("items");
        assertEquals("Snakes", items.getJSONObject(0).getString("title"));
        assertEquals(200, cap.call(new JSONObject().put("op", "continue-decide").put("contentId", "plex:600").put("decision", "keep")).status);
        assertEquals(200, cap.call(new JSONObject().put("op", "continue-decide").put("all", true).put("decision", "clear")).status);
        assertEquals(java.util.Arrays.asList("plex:600=keep", "*=clear"), api.decisions);
        assertEquals(400, cap.call(new JSONObject().put("op", "continue-decide").put("all", true).put("decision", "keep")).status);
        assertEquals(400, cap.call(new JSONObject().put("op", "continue-decide").put("contentId", "../x").put("decision", "clear")).status);
    }

    @Test public void aKeptBookOpensNowPlayingWithABooksStartingFrame() {
        assertTrue(MediaServiceCapability.longKind("book"));
        assertTrue(MediaServiceCapability.longKind("series"));
        assertFalse(MediaServiceCapability.longKind("album"));
        assertFalse(MediaServiceCapability.longKind("playlist"));
        assertFalse(MediaServiceCapability.longKind(null));
    }

    /** Shakespeare: 660 tracks; the first 500 held 29 of his 36 books. Every page is read. */
    @Test public void anAuthorsBooksAreCountedFromEveryPageOfTracks() throws Exception {
        api.responses.put("info plex:7", new JSONObject().put("id", "plex:7").put("metadata", new JSONObject()).toString());
        org.json.JSONArray first = new org.json.JSONArray(), second = new org.json.JSONArray();
        for (int i = 0; i < 500; i++) first.put(new JSONObject().put("id", "plex:" + (1000 + i)).put("albumId", String.valueOf(100 + i / 20)).put("duration", 60));
        for (int i = 0; i < 160; i++) second.put(new JSONObject().put("id", "plex:" + (2000 + i)).put("albumId", String.valueOf(200 + i / 20)).put("duration", 60));
        api.responses.put("list plex:library/metadata/7/allLeaves 500 0", new JSONObject().put("total", 660).put("items", first).toString());
        api.responses.put("list plex:library/metadata/7/allLeaves 500 500", new JSONObject().put("total", 660).put("items", second).toString());
        api.responses.put("recent 200", "{\"items\":[]}");
        JSONObject about = cap.call(new JSONObject().put("op", "about").put("id", "plex:7").put("books", true)).body.getJSONObject("about");
        assertEquals(25 + 8, about.getInt("children"));
        assertEquals(660 * 60, about.getLong("totalSec"));
    }

    /** The phone's Continue: long audio only (a film's audio and a 79-second item showed there, 2026-11-27). */
    @Test public void continueListeningOnThePhoneIsLongAudioOnly() throws Exception {
        api.responses.put("continue 12", continueAnswer(0,
                "{\"contentId\":\"plex:10\",\"playContentId\":\"plex:12\",\"title\":\"Henry VI Part 3\",\"partIndex\":2,\"partCount\":5,\"playhead\":600,\"duration\":900,\"type\":\"album\",\"kind\":\"books\"}",
                "{\"contentId\":\"plex:622178\",\"title\":\"Indiana Jones - Raiders of the Lost Ark\",\"playhead\":385,\"duration\":691,\"type\":\"track\",\"kind\":\"books\"}",
                "{\"contentId\":\"plex:441034\",\"title\":\"Orlando Saunders\",\"playhead\":17,\"duration\":79,\"type\":\"track\",\"kind\":\"books\"}",
                "{\"contentId\":\"plex:5\",\"title\":\"A film\",\"playhead\":1200,\"duration\":7200,\"type\":\"movie\"}",
                "{\"contentId\":\"plex:6\",\"title\":\"A song\",\"playhead\":30,\"duration\":240,\"type\":\"track\",\"kind\":\"music\"}",
                "{\"contentId\":\"plex:727000\",\"title\":\"A single-file book\",\"playhead\":600,\"duration\":17687,\"type\":\"track\",\"kind\":\"books\"}"));
        org.json.JSONArray items = cap.call(new JSONObject().put("op", "continue").put("limit", 8)).body.getJSONArray("items");
        assertEquals(2, items.length());
        assertEquals("Henry VI Part 3", items.getJSONObject(0).getString("title"));
        assertEquals("A single-file book", items.getJSONObject(1).getString("title"));
    }
}
