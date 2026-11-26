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
        assertEquals(4, sent.size());
        assertTrue(sent.get(3), sent.get(3).endsWith("/session/queue/clear"));
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
        assertEquals("https://kiosk.example" + proxied + "&offset=30",
                saved.getJSONArray("tracks").getJSONObject(0).getString("url"));

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
        assertEquals("https://kiosk.example" + proxied + "&offset=30",
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
}
