package net.kckern.daylight.cap.notifications;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.backend.Backend;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class NotificationsCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private File dir;
    private CoreRuntime core;
    private NotificationsCapability cap;
    private String key;
    private final List<String> seen = new ArrayList<>();
    private final List<Boolean> keyedSeen = new ArrayList<>();
    private final PayloadPort port = PayloadPort.named(PayloadPort.LINKS);

    private LinkHandler handler(final String kind, final JSONObject answer) {
        return new LinkHandler() {
            @Override public String kind() { return kind; }
            @Override public JSONObject handle(String arg, Map<String, String> query) {
                seen.add(kind + " " + arg + " " + query);
                if ("nope".equals(arg)) throw new IllegalArgumentException("unknown thing 'nope'");
                if ("boom".equals(arg)) throw new IllegalStateException("broke");
                return answer;
            }
            @Override public JSONObject handle(String arg, Map<String, String> query, boolean keyed) throws Exception {
                keyedSeen.add(keyed);
                return handle(arg, query);
            }
        };
    }

    @Before public void setUp() throws Exception {
        dir = tmp.newFolder();
        core = TestCore.create(dir);
        cap = new NotificationsCapability();
        core.add(cap);
        core.services().provide(LinkHandler.class, handler("open", LinkEffect.toast("opened")));
        core.services().provide(LinkHandler.class, handler("action", LinkEffect.none()));
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        key = core.services().find(LinkKeySource.class).installKey();
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private JSONObject link(String uri) throws Exception {
        return TestCore.call(core, "POST", "/link", null, new JSONObject().put("uri", uri).toString());
    }

    @Test public void dispatchesALinkToTheCapabilityThatOwnsItsKind() throws Exception {
        JSONObject r = link("daylight://open?path=/media");
        assertEquals(200, r.getInt("_status"));
        assertEquals("opened", r.getString("message"));
        assertEquals("[open  {path=/media}]", seen.toString());
    }

    @Test public void aKeyedLinkWithoutTheKeyIsRefusedAndNeverDispatched() throws Exception {
        JSONObject r = link("daylight://action/lights-off");
        assertEquals(403, r.getInt("_status"));
        assertEquals("forbidden", r.getString("error"));
        assertFalse(r.getBoolean("ok"));
        assertTrue(seen.isEmpty());
        assertEquals(403, link("daylight://action/lights-off#k=" + key.replace(key.charAt(0), 'x')).getInt("_status"));
        assertTrue(seen.isEmpty());
        assertEquals(200, link("daylight://action/lights-off#k=" + key).getInt("_status"));
        assertEquals("[action lights-off {}]", seen.toString());
    }

    @Test public void theHandlerIsToldWhetherTheLinkCarriedThisInstallsKey() throws Exception {
        link("daylight://open?path=/media");
        link("daylight://open?path=/media#k=" + key);
        link("daylight://open?path=/media#k=" + key.replace(key.charAt(0), 'x'));
        link("https://kiosk.example/media");
        link("daylight://action/lights-off#k=" + key);
        assertEquals("[false, true, false, false, true]", keyedSeen.toString());
        assertEquals("the key itself is never handed on", -1, seen.toString().indexOf(key));
    }

    @Test public void aKindNoCapabilityOwnsIsAMessageNotAnError() throws Exception {
        // A media link starts playback, so it is refused without this install's key.
        assertEquals(403, link("daylight://media/play?id=plex:1").getInt("_status"));
        JSONObject r = link("daylight://media/play?id=plex:1#k=" + key);
        assertEquals(200, r.getInt("_status"));
        assertEquals("toast", r.getString("effect"));
        assertEquals("Not available on this device", r.getString("message"));
    }

    @Test public void aMalformedLinkIsABadRequest() throws Exception {
        assertEquals(400, link("https://evil.example/").getInt("_status"));
        assertEquals(400, link("intent://x#Intent;end").getInt("_status"));
        assertEquals(400, TestCore.call(core, "POST", "/link", null, "{}").getInt("_status"));
        assertEquals(400, TestCore.call(core, "POST", "/link", null, "not json").getInt("_status"));
        assertTrue(seen.isEmpty());
    }

    @Test public void aLinkThatNamesSomethingUnknownIsRefused() throws Exception {
        JSONObject r = link("daylight://action/nope#k=" + key);
        assertEquals(400, r.getInt("_status"));
        assertEquals("bad_link", r.getString("error"));
        assertFalse(r.getBoolean("ok"));
    }

    @Test public void aHandlerThatBreaksIsAnAnswerNotACrash() throws Exception {
        JSONObject r = link("daylight://action/boom#k=" + key);
        assertEquals(500, r.getInt("_status"));
        assertEquals("failed", r.getString("error"));
    }

    @Test public void aLinkOfTheHouseholdSiteOpensItsPath() throws Exception {
        assertEquals(200, link("https://kiosk.example/media/channels?x=1").getInt("_status"));
        assertEquals("[open  {path=/media/channels?x=1}]", seen.toString());
    }

    @Test public void anExtraOriginCanBeAllowedBySetting() throws Exception {
        assertEquals(400, link("https://home.example/feed").getInt("_status"));
        core.settings().set("links.origins", "https://home.example, https://other.example");
        assertEquals(200, link("https://home.example/feed").getInt("_status"));
        try {
            core.settings().set("links.origins", "https://home.example, not-an-origin");
            fail("accepted a list with a part that has no origin");
        } catch (RuntimeException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("links.origins"));
        }
    }

    @Test public void everyRefusalIsLoggedWithoutTheLink() throws Exception {
        FakeShell shell = (FakeShell) core.shell();
        link("daylight://action/lights-off#k=wrong-key-wrong-key-wrong-key-wrong");
        link("https://evil.example/steal#k=" + key);
        String notes = shell.notes.toString();
        assertTrue(notes, notes.contains("LINK refused"));
        assertFalse(notes, notes.contains("evil.example"));
        assertFalse(notes, notes.contains(key));
        assertFalse(notes, notes.contains("wrong-key"));
    }

    @Test public void aFloodOfRefusedLinksDoesNotFloodTheLog() throws Exception {
        FakeShell shell = (FakeShell) core.shell();
        for (int i = 0; i < 200; i++) link("https://evil.example/" + i);
        assertTrue("wrote " + shell.notes.size() + " notes", shell.notes.size() <= 5);
    }

    @Test public void theKeyIsNotServedByAnyRoute() {
        for (String route : core.router().routes()) assertFalse(route, route.contains("key"));
    }

    @Test public void namesItself() {
        assertEquals("notifications", new NotificationsCapability().name());
    }

    // ── the port the installed link activity calls ────────────────────────────

    @Test public void startAttachesThePortAndStopDetachesItTwice() throws Exception {
        CoreRuntime withContext = TestCore.createWithContext(tmp.newFolder(), new FakeContext(tmp.newFolder()));
        NotificationsCapability started = new NotificationsCapability();
        withContext.add(started);
        withContext.services().provide(LinkHandler.class, handler("open", LinkEffect.front()));
        withContext.prepare(new JSONObject());
        withContext.settings().set(Backend.BASE_URL, "https://kiosk.example");
        started.start();
        try {
            assertTrue(port.ready());
            JSONObject answer = new JSONObject(port.call("{\"uri\":\"daylight://open?path=/feed\"}", 0));
            assertTrue(answer.getBoolean("ok"));
            assertEquals("front", answer.getString("effect"));
            JSONObject refused = new JSONObject(port.call("{\"uri\":\"https://evil.example/\"}", 0));
            assertFalse(refused.getBoolean("ok"));
            assertEquals("bad_link", refused.getString("error"));
            assertFalse("the port's answer carries no HTTP status", refused.has("_status"));
            assertFalse(new JSONObject(port.call("garbage", 0)).getBoolean("ok"));
        } finally {
            started.stop();
        }
        assertFalse(port.ready());
        started.stop();
        assertFalse(port.ready());
    }

    @Test public void aPayloadThatStopsLateDoesNotDetachItsSuccessor() throws Exception {
        NotificationsCapability next = new NotificationsCapability();
        CoreRuntime second = TestCore.create(tmp.newFolder());
        second.add(next);
        second.prepare(new JSONObject());
        cap.start();
        next.start();       // a swap: the new payload starts before the old one stops
        cap.stop();
        try {
            assertTrue(port.ready());
        } finally {
            next.stop();
        }
        assertFalse(port.ready());
    }

    // ── the key rotates at every payload start ───────────────────────────────

    @Test public void theKeyRotatesAtEachStartSoALinkSeenOnceStopsWorking() throws Exception {
        final long[] now = { 1_000_000 };
        cap.clock = () -> now[0];
        String before = key;
        cap.start();
        String after = core.services().find(LinkKeySource.class).installKey();
        assertNotEquals(before, after);
        assertEquals(200, link("daylight://action/lights-off#k=" + after).getInt("_status"));
        // The tap that woke the app carries the key of the run before: it is honoured for a moment.
        assertEquals(200, link("daylight://action/lights-off#k=" + before).getInt("_status"));
        now[0] += NotificationsCapability.PREVIOUS_KEY_MS + 1;
        assertEquals("after that the old key is no key", 403, link("daylight://action/lights-off#k=" + before).getInt("_status"));
        assertEquals(200, link("daylight://action/lights-off#k=" + after).getInt("_status"));
        // And a key from two starts ago never works.
        cap.stop();
        cap.start();
        assertEquals(403, link("daylight://action/lights-off#k=" + before).getInt("_status"));
        assertEquals("the one before this start still does, for its moment", 200, link("daylight://action/lights-off#k=" + after).getInt("_status"));
    }

    @Test public void aKeyInTheQueryIsRefusedAndNeverLogged() throws Exception {
        FakeShell shell = (FakeShell) core.shell();
        assertEquals(403, link("daylight://action/lights-off?k=" + key).getInt("_status"));
        assertTrue(seen.isEmpty());
        assertFalse(shell.notes.toString(), shell.notes.toString().contains(key));
    }
    /** Capture starts from a keyed link or not at all: an input link from a page or another app never reaches its handler. */
    @Test public void anInputLinkWithoutTheKeyIsRefusedAndNeverReachesTheCaptureScreens() throws Exception {
        core.services().provide(LinkHandler.class, handler("input", LinkEffect.none()));
        core.services().provide(LinkHandler.class, handler("memo", LinkEffect.none()));
        for (String uri : new String[] { "daylight://input/voice?to=journal", "daylight://input/text?to=journal-note",
                "daylight://input/photo?to=meal-photo", "daylight://input/photo?to=meal-photo&k=" + key,
                "daylight://input/photo?to=meal-photo#k=" + key.replace(key.charAt(0), 'x'), "daylight://memo/new",
                "daylight://input/discard", "daylight://input/queue" }) {
            JSONObject r = link(uri);
            assertEquals(uri.replace(key, "KEY"), 403, r.getInt("_status"));
            assertEquals("forbidden", r.getString("error"));
        }
        assertTrue("nothing was dispatched", seen.isEmpty());
        assertEquals(200, link("daylight://input/photo?to=meal-photo#k=" + key).getInt("_status"));
        assertEquals("[input photo {to=meal-photo}]", seen.toString());
        assertEquals("[true]", keyedSeen.toString());
    }

    @Test public void aNoticeMayOpenAnInputLinkAndIsGivenTheKeyForIt() throws Exception {
        Notice n = Notice.of("input-queue", net.kckern.daylight.core.spi.LocalNotices.UPLOADS, "Quick inputs", "1 input waiting to upload (Journal 1)",
                "daylight://input/queue", "Discard", "daylight://input/discard", key);
        assertEquals("daylight://input/queue#k=" + key, n.uri);
        assertEquals("daylight://input/discard#k=" + key, n.actionUri);
    }
}
