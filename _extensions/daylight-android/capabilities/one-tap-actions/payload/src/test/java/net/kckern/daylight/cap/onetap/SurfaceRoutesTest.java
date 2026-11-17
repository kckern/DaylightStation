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
        assertEquals("daylight://action/memo#k=" + KEY, sink.publishedUris.get(0));
        assertEquals("New memo", sink.cache.get("tile.1.label"));
        assertEquals("daylight://action/memo#k=" + KEY, sink.cache.get("tile.1.uri"));
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
        assertEquals("memo daylight://action/memo#k=" + KEY, sink.pinned);
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

    @Test public void publishingRewritesThePinnedShortcutsWithTheCurrentKey() throws Exception {
        post("/actions/pin", "{\"id\":\"memo\"}");
        sink.pinnedIds.add("pin-removed");
        assertEquals(200, post("/actions/publish", null).getInt("_status"));
        assertEquals(java.util.Collections.singletonList("pin-memo daylight://action/memo#k=" + KEY), sink.refreshed);
        assertEquals(java.util.Collections.singletonList("pin-removed"), sink.disabled);
    }

    // ── pinned media actions (the page bridge's pinMedia) ─────────────────────

    private net.kckern.daylight.core.spi.ShortcutPinner pinner() {
        net.kckern.daylight.core.spi.ShortcutPinner p = core.services().find(net.kckern.daylight.core.spi.ShortcutPinner.class);
        assertNotNull(p);
        return p;
    }

    @Test public void aPinIsAskedOfTheLauncherUnderAnIdOfItsOwnAndRecordedWhenTheLauncherTakesTheRequest() throws Exception {
        cap.start();
        JSONObject r = pinner().pinMedia("plex:12345", "Morning music");
        assertTrue(r.toString(), r.getBoolean("accepted"));
        String id = PinnedMedia.idFor("plex:12345");
        assertEquals("the shortcut launches the pinned action by its id, keyed like every action link",
                id + " daylight://action/" + id + "#k=" + KEY, sink.pinned);
        assertFalse("the content id never travels in a link", sink.pinned.contains("12345"));
        assertEquals("plex:12345", core.services().find(ActionList.class).mediaContentId(id));
    }

    /** The pinned action is offered to the one-action button's chooser (through ActionList) and plays with no window. */
    @Test public void aPinnedActionIsListedForTheButtonChooserAndIsPlayableDirectly() throws Exception {
        cap.start();
        pinner().pinMedia("plex:12345", "Morning music");
        String id = PinnedMedia.idFor("plex:12345");
        org.json.JSONArray actions = core.services().find(ActionList.class).actions();
        JSONObject last = actions.getJSONObject(actions.length() - 1);
        assertEquals(id, last.getString("id"));
        assertEquals("Morning music", last.getString("label"));
        assertEquals("daylight://action/" + id + "#k=" + KEY, last.getString("uri"));
        assertEquals(id, last.getString("direct"));
        assertTrue("the widgets are told to redraw", events.contains(ActionList.PUBLISHED));
        assertFalse("not a launcher (long-press) shortcut unless the settings list it", sink.published.contains(id));
    }

    @Test public void runningAPinnedActionPlaysItsContentThroughTheMediaHandler() throws Exception {
        final List<String> handled = new ArrayList<>();
        core.services().provide(net.kckern.daylight.core.spi.LinkHandler.class, new net.kckern.daylight.core.spi.LinkHandler() {
            @Override public String kind() { return "media"; }
            @Override public JSONObject handle(String arg, java.util.Map<String, String> query) {
                handled.add(arg + " " + query);
                return new JSONObject();
            }
        });
        cap.start();
        pinner().pinMedia("plex:12345", "Morning music");
        TestCore.call(core, "POST", "/actions/run", null, new JSONObject().put("id", PinnedMedia.idFor("plex:12345")).toString());
        assertEquals(java.util.Collections.singletonList("play {id=plex:12345}"), handled);
    }

    @Test public void nothingIsRecordedWhenTheLauncherCannotPinOrRefuses() throws Exception {
        cap.start();
        sink.pinSupported = false;
        assertFalse(pinner().canPin());
        JSONObject r = pinner().pinMedia("plex:12345", "Radio");
        assertFalse(r.getBoolean("accepted"));
        assertEquals("launcher_cannot_pin", r.getString("reason"));
        sink.pinSupported = true;
        sink.refuse = true;
        r = pinner().pinMedia("plex:12345", "Radio");
        assertEquals("launcher_refused", r.getString("reason"));
        assertNull(core.services().find(ActionList.class).mediaContentId(PinnedMedia.idFor("plex:12345")));
    }

    @Test public void withNoRunningAppNothingCanBePinned() throws Exception {
        OneTapActionsCapability bare = new OneTapActionsCapability();
        CoreRuntime other = TestCore.create(tmp.newFolder());
        other.add(bare);
        other.prepare(new JSONObject());
        net.kckern.daylight.core.spi.ShortcutPinner p = other.services().find(net.kckern.daylight.core.spi.ShortcutPinner.class);
        assertFalse(p.canPin());
        assertEquals("not_available", p.pinMedia("plex:1", "Radio").getString("reason"));
    }

    @Test public void thePinnedActionsOutliveTheRunAndTheOldestGoesAtTwentyFiveWithItsShortcutDisabled() throws Exception {
        cap.start();
        for (int i = 0; i < 25; i++) pinner().pinMedia("plex:" + i, "L" + i);
        String first = PinnedMedia.idFor("plex:0");
        assertNull("the oldest is gone", core.services().find(ActionList.class).mediaContentId(first));
        assertTrue("its pinned shortcut is disabled", sink.disabled.contains("pin-" + first));

        OneTapActionsCapability again = new OneTapActionsCapability(null, new RecordingSink());
        CoreRuntime next = TestCore.create(core.shell().payloadDir());
        next.add(again);
        next.prepare(new JSONObject());
        assertEquals("plex:24", next.services().find(ActionList.class).mediaContentId(PinnedMedia.idFor("plex:24")));
        assertEquals("plex:1", next.services().find(ActionList.class).mediaContentId(PinnedMedia.idFor("plex:1")));
    }

    @Test public void aConfiguredActionKeepsItsIdOverAPinnedOne() throws Exception {
        String id = PinnedMedia.idFor("plex:12345");
        core.settings().set("actions.3", id + "|Configured|play|open:/media");
        cap.start();
        pinner().pinMedia("plex:12345", "Pinned");
        assertNull("the configured action is not a media action", core.services().find(ActionList.class).mediaContentId(id));
    }

    @Test public void theAnswerNeverHoldsALinkTheKeyOrThePinnedList() throws Exception {
        cap.start();
        pinner().pinMedia("plex:1", "One");
        JSONObject r = pinner().pinMedia("plex:2", "Two");
        assertEquals(1, r.length());
        assertFalse(r.toString().contains(KEY));
        assertFalse(r.toString().contains("daylight://"));
        assertFalse(r.toString().contains("media-"));
    }
}
