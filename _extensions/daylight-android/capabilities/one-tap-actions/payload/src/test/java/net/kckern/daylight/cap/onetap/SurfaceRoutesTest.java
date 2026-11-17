package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.ActionList;
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

import java.util.ArrayList;
import java.util.List;

public class SurfaceRoutesTest {
    private static final String KEY = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private OneTapActionsCapability cap;
    private final RecordingSink sink = new RecordingSink();
    private final List<String> events = new ArrayList<>();

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new OneTapActionsCapability(null, sink);
        core.add(cap);
        core.prepare(new JSONObject());
        core.services().provide(LinkKeySource.class, () -> KEY);
        core.settings().set("actions.1", "memo|New memo|mic|memo:new");
        core.settings().set("actions.2", "feed|Feed|open|open:/feed");
        core.events().subscribe((topic, detail) -> events.add(topic));
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private JSONObject post(String path, String body) throws Exception {
        return TestCore.call(core, "POST", path, null, body);
    }

    @Test public void startPublishesShortcutsAndTheTileCacheWithKeyedLinks() throws Exception {
        core.settings().set("actions.tiles", "memo");
        cap.start();
        assertEquals("[memo, feed]", sink.published.toString());
        assertEquals("daylight://action/memo?k=" + KEY, sink.publishedUris.get(0));
        assertEquals("New memo", sink.cache.get("tile.1.label"));
        assertEquals("daylight://action/memo?k=" + KEY, sink.cache.get("tile.1.uri"));
        assertTrue("other surfaces are told", events.contains(ActionList.PUBLISHED));
    }

    @Test public void publishCanBeAskedForAfterASettingChangesAndAnswersWithoutTheKey() throws Exception {
        core.settings().set("actions.shortcuts", "feed");
        core.settings().set("actions.tiles", "memo");
        JSONObject r = post("/actions/publish", "{}");
        assertEquals(200, r.getInt("_status"));
        assertEquals("feed", r.getJSONArray("shortcuts").getString(0));
        assertEquals("memo", r.getJSONArray("tiles").getString(0));
        assertEquals("[feed]", sink.published.toString());
        assertEquals(1, sink.publishes);
        assertFalse(r.toString().contains(KEY));
        assertTrue(events.contains(ActionList.PUBLISHED));
    }

    @Test public void pinAsksTheLauncherForOneAction() throws Exception {
        JSONObject r = post("/actions/pin", "{\"id\":\"memo\"}");
        assertEquals(200, r.getInt("_status"));
        assertEquals("memo daylight://action/memo?k=" + KEY, sink.pinned);
        assertFalse(r.toString().contains(KEY));
        assertEquals(400, post("/actions/pin", "{\"id\":\"nope\"}").getInt("_status"));
    }

    @Test public void pinOnALauncherThatCannotIsUnsupportedWithTheReason() throws Exception {
        sink.pinSupported = false;
        JSONObject r = post("/actions/pin", "{\"id\":\"memo\"}");
        assertEquals(501, r.getInt("_status"));
        assertEquals("this launcher does not pin shortcuts", r.getString("reason"));
    }

    @Test public void aSurfaceListThatNamesAnUnknownActionIsLeftOutAndReportedAndStartDoesNotThrow() throws Exception {
        core.settings().set("actions.shortcuts", "nope,feed");
        cap.start();
        assertEquals("[feed]", sink.published.toString());
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("actions.shortcuts names unknown action 'nope'"));
        assertTrue(post("/actions/publish", "{}").getJSONArray("problems").getString(0).contains("nope"));
    }

    @Test public void theActionListSaysWhatASurfaceListCannotPlaceEvenBeforeAnythingIsPublished() throws Exception {
        core.settings().set("actions.tiles", "memo,nope");
        JSONObject list = TestCore.get(core, "/actions");
        assertEquals(1, list.getJSONArray("problems").length());
        assertTrue(list.getJSONArray("problems").getString(0).contains("actions.tiles names unknown action 'nope'"));
        assertEquals("the bookmark an action opens is listed, so a device file can be checked", "new",
                list.getJSONArray("actions").getJSONObject(0).getString("target"));
        assertEquals(0, sink.publishes);
    }

    @Test public void aSurfaceListOfTheWrongShapeIsRefusedWhenItIsSet() {
        try { core.settings().set("actions.tiles", "a,b,c,d,e"); fail("accepted five tiles"); }
        catch (RuntimeException expected) { assertTrue(expected.getMessage(), expected.getMessage().contains("at most 4")); }
        try { core.settings().set("actions.shortcuts", "Not An Id"); fail("accepted a bad id"); }
        catch (RuntimeException expected) { }
    }

    @Test public void aLauncherThatMisbehavesDoesNotStopThePayload() throws Exception {
        sink.failure = new IllegalStateException("rate limited");
        cap.start();
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("could not publish"));
        assertEquals(500, post("/actions/publish", "{}").getInt("_status"));
    }

    @Test public void withoutAContextNothingIsPublishedAndPublishSaysWhy() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        OneTapActionsCapability plain = new OneTapActionsCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        plain.start();
        plain.stop();
        assertEquals(501, TestCore.call(bare, "POST", "/actions/publish", null, "{}").getInt("_status"));
    }

    @Test public void aRealStartOverADeviceWithNoShortcutServiceWritesNothingAndDoesNotThrow() throws Exception {
        FakeContext context = new FakeContext(tmp.newFolder());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), context);
        OneTapActionsCapability plain = new OneTapActionsCapability();
        real.add(plain);
        real.prepare(new JSONObject());
        real.settings().set("actions.1", "memo|New memo|mic|memo:new");
        plain.start();
        assertEquals(0, context.registered);
        plain.stop();
        plain.stop();
        assertEquals(0, FakeContext.liveThreads(OneTapActionsCapability.WORKER));
    }
}
