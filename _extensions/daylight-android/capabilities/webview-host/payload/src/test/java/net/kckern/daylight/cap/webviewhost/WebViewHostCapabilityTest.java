package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Everything here runs with no Android context and no kiosk Activity, as in any JVM test. */
public class WebViewHostCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private WebViewHostCapability cap;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new WebViewHostCapability();
        assertEquals("webview-host", cap.name());
        core.add(cap);
        core.prepare(new JSONObject());
    }

    private JSONObject post(String path, String body) throws Exception {
        return TestCore.call(core, "POST", path, null, body);
    }

    @Test public void declaresEverySettingWithItsFallback() {
        assertEquals("", core.settings().get("webview.startUrl"));
        assertEquals("", core.settings().get("webview.bridgeOrigins"));
        assertEquals("the script Fully injects today reloads on Back", "reload", core.settings().get("webview.backButton"));
        assertEquals("", core.settings().get("webview.interceptKeys"));
        assertEquals(20, core.settings().get("webview.loadTimeoutSec"));
        assertEquals("a new device gives no page the microphone", Boolean.FALSE, core.settings().get("webview.allowMic"));
        assertEquals("or the camera", Boolean.FALSE, core.settings().get("webview.allowCamera"));
        assertEquals("a new device shows nothing over its lock screen", Boolean.FALSE, core.settings().get("webview.showWhenLocked"));
        assertEquals(Boolean.FALSE, core.settings().get("webview.allowMixedContent"));
        assertEquals(Boolean.FALSE, core.settings().get("webview.debugging"));
        assertEquals(Boolean.FALSE, core.settings().get("webview.launchOnBoot"));
        assertEquals(30, core.settings().get("recovery.reloadOnPageFailureSec"));
        assertEquals(300, core.settings().get("recovery.maxRetrySec"));
        assertEquals(Boolean.TRUE, core.settings().get("recovery.reloadOnNetworkReturn"));
        assertEquals(30, core.settings().get("recovery.rendererUnresponsiveSec"));
    }

    @Test public void registersEveryKioskRouteInTheContract() {
        for (String route : new String[] { "GET /kiosk/status", "POST /kiosk/load", "POST /kiosk/load-start",
                "POST /kiosk/reload", "POST /kiosk/foreground", "POST /kiosk/renderer/reset",
                "POST /kiosk/restart", "POST /kiosk/overlay" }) {
            assertTrue("missing " + route, core.router().routes().contains(route));
        }
    }

    @Test public void offersTheKioskSurfaceToOtherCapabilities() {
        KioskSurface surface = core.services().find(KioskSurface.class);
        assertNotNull(surface);
        assertFalse("no Activity has attached", surface.attached());
        assertFalse(surface.inForeground());
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        cap.start();
        assertFalse(core.services().find(KioskSurface.class).attached());
        cap.stop();
        cap.stop();
    }

    @Test public void loadRefusesAnythingThatIsNotHttp() throws Exception {
        assertEquals(400, post("/kiosk/load", "{\"url\":\"file:///sdcard/x.html\"}").getInt("_status"));
        assertEquals(400, post("/kiosk/load", "{\"url\":\"javascript:alert(1)\"}").getInt("_status"));
        assertEquals(400, post("/kiosk/load", "{\"url\":7}").getInt("_status"));
        assertEquals(400, post("/kiosk/load", "{}").getInt("_status"));
        assertEquals(400, post("/kiosk/load", "not json").getInt("_status"));
    }

    @Test public void loadStartWithoutAStartUrlIsABadRequest() throws Exception {
        JSONObject r = post("/kiosk/load-start", null);
        assertEquals(400, r.getInt("_status"));
        assertTrue(r.getString("message").contains("webview.startUrl"));
        assertEquals(400, post("/kiosk/reload", null).getInt("_status"));
    }

    @Test public void waitMustBeABoolean() throws Exception {
        assertEquals(400, post("/kiosk/load", "{\"url\":\"https://kiosk.example/\",\"wait\":\"no\"}").getInt("_status"));
        assertEquals(400, post("/kiosk/reload", "{\"wait\":0}").getInt("_status"));
    }

    @Test public void anUnwaitedLoadWithNoKioskActivityIsQueuedForTheNextOneAndAccepted() throws Exception {
        core.settings().set("webview.startUrl", "https://kiosk.example/start");
        JSONObject first = post("/kiosk/load", "{\"url\":\"https://kiosk.example/a\",\"wait\":false}");
        assertEquals(200, first.getInt("_status"));
        assertTrue(first.getBoolean("ok"));
        assertTrue(first.getBoolean("accepted"));
        assertTrue("it says the load is waiting for a window", first.getBoolean("queued"));
        assertEquals("https://kiosk.example/a", first.getString("url"));
        assertFalse(first.getString("loadId").isEmpty());

        // The latest request wins: one slot, so nothing piles up while no window is up.
        JSONObject second = post("/kiosk/load", "{\"url\":\"https://kiosk.example/b\",\"wait\":false}");
        assertTrue(second.getBoolean("accepted"));
        assertNotEquals(first.getString("loadId"), second.getString("loadId"));
    }

    @Test public void aWaitedLoadWithNoKioskActivityAnswersWithoutWaitingForAPage() throws Exception {
        core.settings().set("webview.startUrl", "https://kiosk.example/start");
        long began = System.currentTimeMillis();
        JSONObject r = post("/kiosk/load", "{\"url\":\"https://kiosk.example/\"}");
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertFalse(r.getBoolean("loaded"));
        assertEquals("no_kiosk_activity", r.getString("error"));
        assertTrue("the kiosk could not even be started, so there is nothing to wait for",
                System.currentTimeMillis() - began < 3000);
    }

    @Test public void statusSaysWhyTheKioskIsNotReady() throws Exception {
        JSONObject s = TestCore.get(core, "/kiosk/status");
        assertEquals(200, s.getInt("_status"));
        assertTrue(s.getBoolean("ok"));
        assertFalse(s.getBoolean("ready"));
        assertEquals("an empty start URL means the kiosk is not configured", "webview.startUrl is not set", s.getString("reason"));
        assertEquals("", s.getString("startUrl"));
        assertFalse(s.getBoolean("kioskInForeground"));
        assertFalse(s.getBoolean("locked"));
        assertFalse(s.getBoolean("rendererAlive"));
        assertFalse(s.getBoolean("screenOn"));
        for (String key : new String[] { "currentUrl", "foreground", "foregroundActivity", "lastLoad" }) {
            assertTrue("missing " + key, s.has(key));
        }
        assertTrue("nothing is known to be in front", s.isNull("foreground"));
        assertTrue(s.isNull("foregroundActivity"));
        assertTrue(s.isNull("lastLoad"));

        core.settings().set("webview.startUrl", "https://kiosk.example/piano");
        s = TestCore.get(core, "/kiosk/status");
        assertEquals("https://kiosk.example/piano", s.getString("startUrl"));
        assertEquals("no kiosk activity", s.getString("reason"));
    }

    @Test public void foregroundIsNotOkUntilTheKioskIsSeenInFront() throws Exception {
        JSONObject r = post("/kiosk/foreground", null);
        assertEquals("the backend maps by status: it could not be done in this state", 409, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_in_foreground", r.getString("error"));
        assertFalse(r.getBoolean("kioskInForeground"));
        assertTrue(r.isNull("foreground"));
    }

    @Test public void aRendererResetWithNoKioskActivityIsNotOk() throws Exception {
        JSONObject r = post("/kiosk/renderer/reset", null);
        assertEquals(409, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertEquals("no_kiosk_activity", r.getString("error"));
        assertFalse(r.getBoolean("rendererAlive"));
    }

    @Test public void restartAsksTheShellToRestartThePayloadAfterAnswering() throws Exception {
        FakeShell shell = (FakeShell) core.shell();
        JSONObject r = post("/kiosk/restart", null);
        assertTrue(r.getBoolean("ok"));
        assertTrue(r.getBoolean("restarting"));
        long deadline = System.currentTimeMillis() + 3000;
        while (shell.restarts.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals(1, shell.restarts.size());
    }

    // ── POST /kiosk/overlay: two independent layers ──────────────────────────

    @Test public void anEmptyOverlayBodyClearsBothLayersAndReportsEach() throws Exception {
        JSONObject r = post("/kiosk/overlay", "{}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("ok"));
        assertFalse(r.getBoolean("shown"));
        assertEquals("none", r.getString("kind"));
        assertFalse(r.getJSONObject("text").getBoolean("shown"));
        assertFalse(r.getJSONObject("web").getBoolean("shown"));
        assertTrue(r.getJSONObject("web").isNull("url"));
        assertTrue(post("/kiosk/overlay", null).getBoolean("ok"));
        assertTrue(post("/kiosk/overlay", "{\"url\":\"\"}").getBoolean("ok"));
        assertTrue(post("/kiosk/overlay", "{\"text\":\"\"}").getBoolean("ok"));
    }

    @Test public void anOverlayThatCannotBeDrawnIsNotReportedAsShown() throws Exception {
        // No Activity and no overlay grant here: neither layer has anywhere to draw.
        JSONObject text = post("/kiosk/overlay", "{\"text\":\"Five minutes left\"}");
        assertEquals(200, text.getInt("_status"));
        assertFalse(text.getBoolean("ok"));
        assertEquals("overlay_not_shown", text.getString("error"));
        assertFalse(text.getBoolean("shown"));

        JSONObject web = post("/kiosk/overlay", "{\"url\":\"https://kiosk.example/overlay\",\"gravity\":\"bottom\"}");
        assertFalse(web.getBoolean("ok"));
        assertEquals("overlay_not_shown", web.getString("error"));
        assertFalse(web.getJSONObject("web").getBoolean("shown"));
        assertEquals("none", web.getString("kind"));
    }

    @Test public void anOverlayRequestThatMakesNoSenseIsABadRequest() throws Exception {
        assertEquals(400, post("/kiosk/overlay", "{\"url\":\"file:///sdcard/x.html\"}").getInt("_status"));
        assertEquals(400, post("/kiosk/overlay", "{\"url\":\"https://kiosk.example/o\",\"gravity\":\"left\"}").getInt("_status"));
        assertEquals(400, post("/kiosk/overlay", "{\"text\":5}").getInt("_status"));
        assertEquals(400, post("/kiosk/overlay", "not json").getInt("_status"));
    }

    // ── a real start, over a fake Android context ───────────────────────────

    /** A kiosk Activity as the shell would publish it. */
    private static final class FakeHost implements net.kckern.daylight.api.KioskHost {
        final java.util.List<Object> attached = new java.util.ArrayList<>();
        @Override public Object activity() { return null; }
        final java.util.List<Object> detached = new java.util.ArrayList<>();
        @Override public void attach(net.kckern.daylight.api.KioskController controller) { attached.add(controller); }
        @Override public void detach(net.kckern.daylight.api.KioskController expected) { detached.add(expected); }
        @Override public boolean resumed() { return false; }
        @Override public void showWhenLocked(boolean on) { }
    }

    /**
     * What a JVM test can see of a real start: the event subscription and the offer of
     * the session to the Activity. The Activity completing the attach builds a WebView,
     * which needs a device, so the detach on stop is on the on-device list.
     */
    @Test public void aRealStartSubscribesAndOffersItsSessionToTheActivityAndStopEndsBoth() throws Exception {
        java.io.File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        net.kckern.daylight.core.testing.FakeShell shell = new net.kckern.daylight.core.testing.FakeShell(dir);
        shell.context = ctx;
        FakeHost activity = new FakeHost();
        shell.components.put(net.kckern.daylight.api.KioskHost.COMPONENT, activity);   // the Activity outlives a payload swap
        net.kckern.daylight.core.CoreRuntime real = new net.kckern.daylight.core.CoreRuntime(shell, "test", "p-test", new java.io.File(dir, "state"));
        WebViewHostCapability kiosk = new WebViewHostCapability();
        real.add(kiosk);
        real.prepare(new JSONObject());
        assertEquals(0, real.events().subscribers());

        kiosk.start();
        assertEquals("subscribed to screen, network and key events", 1, real.events().subscribers());
        assertEquals("attached its session to the Activity that was already there", 1, activity.attached.size());
        assertNotNull(activity.attached.get(0));

        kiosk.stop();
        assertEquals("unsubscribed", 0, real.events().subscribers());
        // A late stop must not take the next payload's window: it names its own session
        // and leaves the comparison to the Activity. It never attaches null.
        assertEquals("only ever attached its session", 1, activity.attached.size());
        assertEquals(1, activity.detached.size());
        assertSame(activity.attached.get(0), activity.detached.get(0));
        kiosk.stop();
        assertEquals(0, real.events().subscribers());

        // An Activity that appears after stop is not handed a stopped payload's session.
        FakeHost late = new FakeHost();
        real.onShellComponent(net.kckern.daylight.api.KioskHost.COMPONENT, late);
        assertTrue(late.attached.isEmpty());
        assertEquals(0, real.events().subscribers());
    }

    // ── PageOpener: what a link or a bookmark uses ────────────────────────────

    @Test public void offersToOpenAPageAndKeepsItForTheNextWindowWhenNoneIsUp() {
        core.settings().set("webview.startUrl", "https://kiosk.example/start");
        net.kckern.daylight.core.spi.PageOpener opener = core.services().find(net.kckern.daylight.core.spi.PageOpener.class);
        assertNotNull(opener);
        assertEquals("no kiosk Activity in a JVM test", "pending", opener.open("https://kiosk.example/media"));
    }

    @Test public void openRefusesAnythingThatIsNotHttp() {
        net.kckern.daylight.core.spi.PageOpener opener = core.services().find(net.kckern.daylight.core.spi.PageOpener.class);
        for (String bad : new String[] { null, "", "javascript:alert(1)", "file:///sdcard/x", "content://x", "intent://x#Intent;end", "/media" }) {
            try { opener.open(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    // ── statuses, the bridge's state and the navigation setting ──────────────

    @Test public void aLoadShapedFailureHasAStatusForEachCause() {
        assertEquals(200, WebViewHostCapability.failureStatus(new LoadTracker.Result("id", "u", true, null, 0, 0)));
        assertEquals(409, WebViewHostCapability.failureStatus(new LoadTracker.Result("id", "u", false, "no_kiosk_activity", 0, 0)));
        assertEquals(504, WebViewHostCapability.failureStatus(new LoadTracker.Result("id", "u", false, "timeout", 0, 0)));
        assertEquals(502, WebViewHostCapability.failureStatus(new LoadTracker.Result("id", "u", false, "-2 net::ERR_NAME_NOT_RESOLVED", 0, 0)));
        assertEquals(502, WebViewHostCapability.failureStatus(new LoadTracker.Result("id", "u", false, "renderer gone", 0, 0)));
    }

    @Test public void statusReportsTheBridgeAndTheRendererLosses() throws Exception {
        JSONObject s = TestCore.get(core, "/kiosk/status");
        assertEquals("no WebView has been built in a JVM test", "unknown", s.getString("bridge"));
        assertTrue(s.isNull("bridgeReason"));
        assertEquals(0, s.getInt("rendererLosses"));
        assertEquals(0, s.getInt("rendererLossesTotal"));
    }

    @Test public void theNavigationAllowlistIsEmptyByDefault() {
        assertEquals("the start origin only", "", core.settings().get("webview.allowedOrigins"));
    }

    @Test public void aRequestedLoadOutsideTheAllowedOriginsIsRefusedBeforeAnythingStarts() throws Exception {
        core.settings().set("webview.startUrl", "https://kiosk.example/start");
        for (String body : new String[] { "{\"url\":\"https://www.example.org/\"}", "{\"url\":\"https://www.example.org/\",\"wait\":false}" }) {
            JSONObject r = post("/kiosk/load", body);
            assertEquals(400, r.getInt("_status"));
            assertTrue(r.getString("message"), r.getString("message").startsWith("origin_not_allowed"));
        }
        core.settings().set("webview.allowedOrigins", "https://www.example.org");
        assertTrue(post("/kiosk/load", "{\"url\":\"https://www.example.org/\",\"wait\":false}").getBoolean("accepted"));
        net.kckern.daylight.core.spi.PageOpener opener = core.services().find(net.kckern.daylight.core.spi.PageOpener.class);
        try { opener.open("https://elsewhere.example/"); fail("a link outside the allowed origins was taken"); }
        catch (IllegalArgumentException expected) { }
    }
}
