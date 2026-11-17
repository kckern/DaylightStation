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
        assertEquals(Boolean.TRUE, core.settings().get("webview.allowMic"));
        assertEquals(Boolean.TRUE, core.settings().get("webview.allowCamera"));
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

    @Test public void anUnwaitedLoadWithNoKioskActivityIsRefusedAtOnceAndSaysWhy() throws Exception {
        JSONObject r = post("/kiosk/load", "{\"url\":\"https://kiosk.example/\",\"wait\":false}");
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertFalse(r.getBoolean("accepted"));
        assertEquals("no_kiosk_activity", r.getString("error"));
        assertEquals("https://kiosk.example/", r.getString("url"));
    }

    @Test public void aWaitedLoadWithNoKioskActivityAnswersWithoutWaitingForAPage() throws Exception {
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
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_in_foreground", r.getString("error"));
        assertFalse(r.getBoolean("kioskInForeground"));
        assertTrue(r.isNull("foreground"));
    }

    @Test public void aRendererResetWithNoKioskActivityIsNotOk() throws Exception {
        JSONObject r = post("/kiosk/renderer/reset", null);
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
}
