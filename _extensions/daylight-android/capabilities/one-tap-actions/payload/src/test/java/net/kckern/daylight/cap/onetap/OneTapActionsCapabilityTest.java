package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.spi.ActionList;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.LinkKeySource;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

public class OneTapActionsCapabilityTest {
    private static final String KEY = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";
    private static final Map<String, String> NO_QUERY = Collections.emptyMap();

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private OneTapActionsCapability cap;
    private final List<String> posted = Collections.synchronizedList(new ArrayList<String>());
    private final List<String> handled = new ArrayList<>();
    private volatile int apiStatus = 200;
    private volatile boolean apiDown;
    private volatile CountDownLatch apiHold;

    private final Http http = new Http() {
        @Override public Reply get(String url) { throw new AssertionError("an action never sends a GET"); }
        @Override public Reply postJson(String url, String json) throws IOException {
            if (apiDown) throw new IOException("no route to host");
            CountDownLatch hold = apiHold;
            if (hold != null) {
                try { hold.await(); } catch (InterruptedException e) { throw new IOException("interrupted"); }
            }
            posted.add(url + " " + json);
            return new Reply(apiStatus, "{}");
        }
        @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) {
            throw new AssertionError("an action never uploads");
        }
    };

    private LinkHandler handler(final String kind) {
        return new LinkHandler() {
            @Override public String kind() { return kind; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                handled.add(kind + " " + arg + " " + query);
                return LinkEffect.front();
            }
        };
    }

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new OneTapActionsCapability(http, new RecordingSink());
        core.add(cap);
        core.prepare(new JSONObject());
        core.services().provide(LinkKeySource.class, () -> KEY);
        core.services().provide(LinkHandler.class, handler("open"));
        core.settings().set(Backend.BASE_URL, "https://kiosk.example:3111");
        core.settings().set("actions.1", "feed|Feed|open|open:/feed");
        core.settings().set("actions.2", "lights|Lights off|bolt|api:/api/v1/home/scenes/all-off");
    }

    @After public void tearDown() {
        CountDownLatch hold = apiHold;
        if (hold != null) hold.countDown();
        cap.stop();
        TestCore.releaseMainThread();
    }

    private LinkHandler actionLink() {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if ("action".equals(h.kind())) return h;
        throw new AssertionError("no action handler");
    }

    private JSONObject run(String id) throws Exception {
        return TestCore.call(core, "POST", "/actions/run", null, new JSONObject().put("id", id).toString());
    }

    @Test public void listsActionsWithoutTheInstallKey() throws Exception {
        JSONObject list = TestCore.get(core, "/actions");
        JSONObject first = list.getJSONArray("actions").getJSONObject(0);
        assertEquals("feed", first.getString("id"));
        assertEquals("Feed", first.getString("label"));
        assertEquals("open", first.getString("icon"));
        assertEquals("open", first.getString("kind"));
        assertFalse("the key stays in the process", list.toString().contains(KEY));
    }

    @Test public void theListForOtherSurfacesCarriesKeyedLinks() throws Exception {
        JSONObject first = core.services().find(ActionList.class).actions().getJSONObject(0);
        assertEquals("feed", first.getString("id"));
        assertEquals("Feed", first.getString("label"));
        assertEquals("daylight://action/feed#k=" + KEY, first.getString("uri"));
    }

    @Test public void anOpenActionIsHandedToTheCapabilityThatOpensViews() throws Exception {
        JSONObject r = actionLink().handle("feed", NO_QUERY);
        assertEquals("front", r.getString("effect"));
        assertEquals("[open  {path=/feed}]", handled.toString());
    }

    @Test public void anApiActionPostsToTheBackendAndSaysWhatHappened() throws Exception {
        assertEquals("Lights off: done", actionLink().handle("lights", NO_QUERY).getString("message"));
        assertEquals("[https://kiosk.example:3111/api/v1/home/scenes/all-off {}]", posted.toString());
        apiStatus = 502;
        assertEquals("Lights off: failed (502)", run("lights").getString("message"));
    }

    @Test public void nothingInALinkChangesWhatAnApiActionCalls() throws Exception {
        // The action is the configured one: fixed method, fixed path, empty body.
        Map<String, String> hostile = new HashMap<>();
        hostile.put("path", "/api/v1/admin/wipe");
        hostile.put("url", "https://evil.example/");
        hostile.put("method", "DELETE");
        hostile.put("body", "{\"all\":true}");
        actionLink().handle("lights", hostile);
        assertEquals("[https://kiosk.example:3111/api/v1/home/scenes/all-off {}]", posted.toString());
    }

    @Test public void anApiActionWithTheLinkDownSaysSoAndIsNotQueued() throws Exception {
        apiDown = true;
        assertEquals("Lights off: no connection", actionLink().handle("lights", NO_QUERY).getString("message"));
        apiDown = false;
        assertTrue("nothing is sent later", posted.isEmpty());
    }

    @Test public void anApiActionThatTakesTooLongAnswersWithoutWaitingForIt() throws Exception {
        cap.apiWaitMs = 100;
        cap.start();
        apiHold = new CountDownLatch(1);
        long began = System.currentTimeMillis();
        assertEquals("Lights off: sent, no answer yet", actionLink().handle("lights", NO_QUERY).getString("message"));
        assertTrue(System.currentTimeMillis() - began < 5000);
        apiHold.countDown();
    }

    @Test public void anUnknownActionIsABadRequest() throws Exception {
        try { actionLink().handle("nope", NO_QUERY); fail("ran an unknown action"); } catch (IllegalArgumentException expected) { }
        assertEquals(400, run("nope").getInt("_status"));
        assertEquals(400, run("").getInt("_status"));
    }

    @Test public void anActionWhoseCapabilityIsAbsentSaysSo() throws Exception {
        core.settings().set("actions.3", "news|News|play|media:plex:12345");
        assertEquals("News: not available on this device", actionLink().handle("news", NO_QUERY).getString("message"));
    }

    @Test public void untilTheRecorderExistsAMemoActionOpensTheAppAndIsMarked() throws Exception {
        core.settings().set("actions.3", "memo|New memo|mic|memo:new");
        JSONObject r = actionLink().handle("memo", NO_QUERY);
        assertEquals("front", r.getString("effect"));
        assertEquals("[open  {path=/}]", handled.toString());
        JSONObject listed = TestCore.get(core, "/actions").getJSONArray("actions").getJSONObject(2);
        assertTrue("the list says the action is a stand-in", listed.getBoolean("placeholder"));
        core.settings().set("actions.memoFallbackPath", "/journal");
        handled.clear();
        actionLink().handle("memo", NO_QUERY);
        assertEquals("[open  {path=/journal}]", handled.toString());
    }

    @Test public void aMemoActionGoesToTheRecorderOnceThereIsOne() throws Exception {
        core.services().provide(LinkHandler.class, handler("memo"));
        core.settings().set("actions.3", "memo|New memo|mic|memo:new");
        actionLink().handle("memo", NO_QUERY);
        assertEquals("[memo new {}]", handled.toString());
        assertFalse(TestCore.get(core, "/actions").getJSONArray("actions").getJSONObject(2).optBoolean("placeholder", false));
    }

    @Test public void aMalformedActionIsRefusedWhenItIsSet() {
        for (String bad : new String[] { "broken line", "x|X|open|shell:rm", "x|X|open|api:/admin", "x|X|open|open:/api/v1/x" }) {
            try { core.settings().set("actions.4", bad); fail("accepted " + bad); }
            catch (RuntimeException expected) { assertTrue(expected.getMessage(), expected.getMessage().contains("actions.4")); }
        }
        try { core.settings().set("actions.memoFallbackPath", "/api/v1/x"); fail("accepted an API path"); }
        catch (RuntimeException expected) { }
    }

    @Test public void aDuplicateIdIsLeftOutAndReportedAndStartDoesNotThrow() throws Exception {
        core.settings().set("actions.3", "feed|Feed again|open|open:/feed2");
        cap.start();
        JSONObject list = TestCore.get(core, "/actions");
        assertEquals(2, list.getJSONArray("actions").length());
        assertTrue(list.getJSONArray("problems").getString(0).contains("used twice"));
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("used twice"));
    }

    @Test public void withNoBackendConfiguredAnApiActionSaysSo() throws Exception {
        core.settings().reset(Backend.BASE_URL);
        assertEquals("Lights off: the household site is not set", actionLink().handle("lights", NO_QUERY).getString("message"));
        assertTrue(posted.isEmpty());
    }

    @Test public void everyRunIsLoggedByIdAndOutcomeOnly() throws Exception {
        actionLink().handle("lights", NO_QUERY);
        String notes = ((FakeShell) core.shell()).notes.toString();
        assertTrue(notes, notes.contains("ACTION lights done"));
        assertFalse(notes, notes.contains("kiosk.example"));
        assertFalse(notes, notes.contains(KEY));
    }

    @Test public void aRealStartTakesAWorkerAndStopGivesItBackTwice() throws Exception {
        FakeContext context = new FakeContext(tmp.newFolder());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), context);
        OneTapActionsCapability started = new OneTapActionsCapability(http, new RecordingSink());
        real.add(started);
        real.prepare(new JSONObject());
        int before = FakeContext.liveThreads(OneTapActionsCapability.WORKER);
        started.start();
        real.settings().set(Backend.BASE_URL, "https://kiosk.example");
        real.settings().set("actions.1", "lights|Lights off|bolt|api:/api/v1/x");
        for (LinkHandler h : real.services().all(LinkHandler.class)) if ("action".equals(h.kind())) h.handle("lights", NO_QUERY);
        assertEquals("the action ran on the capability's worker", before + 1, FakeContext.liveThreads(OneTapActionsCapability.WORKER));
        started.stop();
        long deadline = System.currentTimeMillis() + 3000;
        while (FakeContext.liveThreads(OneTapActionsCapability.WORKER) > before && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals(before, FakeContext.liveThreads(OneTapActionsCapability.WORKER));
        started.stop();
        assertEquals(0, context.registered);
    }

    @Test public void namesItself() {
        assertEquals("one-tap-actions", cap.name());
    }
}
