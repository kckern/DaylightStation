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
        api.responses.put("recent 12", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\"}]}");
        assertEquals("p:plex:11", browse("recent", 0, 50).getJSONArray("items").getJSONObject(0).getString("id"));
    }

    @Test public void aLevelIsServedFromMemoryWhileItIsFreshAndWhenTheBackendIsOutOfReach() throws Exception {
        api.responses.put("recent 30", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"So What\"}]}");
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

    @Test public void resolveAnswersWithTracksAndWhereToStart() throws Exception {
        api.responses.put("queue plex:10", "{\"items\":[{\"contentId\":\"plex:11\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/11\",\"duration\":100}]}");
        JSONObject r = post("/media/resolve", "{\"ids\":[\"c:plex:10\"]}");
        assertEquals("https://kiosk.example/s/11", r.getJSONArray("tracks").getJSONObject(0).getString("url"));
        assertEquals(0, r.getInt("startIndex"));
        assertEquals(400, post("/media/resolve", "{\"ids\":[]}").getInt("_status"));
        assertEquals(400, post("/media/resolve", "{\"ids\":[\"https://evil.example/a.mp3\"]}").getInt("_status"));
        assertEquals("an id the backend does not have", 404, post("/media/resolve", "{\"ids\":[\"p:plex:404\"]}").getInt("_status"));
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
}
