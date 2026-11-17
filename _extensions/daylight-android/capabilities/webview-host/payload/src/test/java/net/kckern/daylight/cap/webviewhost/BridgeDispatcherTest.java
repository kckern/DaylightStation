package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class BridgeDispatcherTest {
    private static final String KEY = "0123456789abcdef0123456789abcdef";
    private BridgeTokens tokens;
    /** The token this test's document was issued. */
    private String TOKEN;
    private final List<String> calls = new ArrayList<>();
    private String url = "https://app.example.test/piano";
    private BridgeDispatcher bridge;

    @Before public void setUp() {
        BridgeDispatcher.Actions actions = new BridgeDispatcher.Actions() {
            @Override public String capabilitiesJson() { calls.add("capabilities"); return "[\"webview-host\"]"; }
            @Override public boolean launch(String json) { calls.add("launch " + json); return json.contains("ok"); }
            @Override public boolean screen(boolean on) { calls.add("screen " + on); return true; }
            @Override public void restartApp() { calls.add("restartApp"); }
            @Override public boolean reboot() { calls.add("reboot"); return false; }
            @Override public void setBackMode(String mode) { calls.add("back " + mode); }
            @Override public String volumeJson(int stream) { calls.add("volume " + stream); return "{\"level\":40}"; }
        };
        tokens = new BridgeTokens(KEY);
        bridge = new BridgeDispatcher(tokens, OriginPolicy.fromSettings("", "https://app.example.test/"), () -> url, actions);
        TOKEN = bridge.open(KEY);
        assertFalse(TOKEN.isEmpty());
    }

    @Test public void aCallWithTheTokenFromAnAllowedOriginRuns() {
        assertEquals("[\"webview-host\"]", bridge.call(TOKEN, "capabilities", ""));
        assertEquals("true", bridge.call(TOKEN, "launch", "{\"package\":\"ok\"}"));
        assertEquals("false", bridge.call(TOKEN, "launch", "{\"package\":\"no\"}"));
        assertEquals("true", bridge.call(TOKEN, "screen", "false"));
        assertEquals("false", bridge.call(TOKEN, "reboot", ""));
        assertEquals("{\"level\":40}", bridge.call(TOKEN, "volume", "3"));
        assertEquals("", bridge.call(TOKEN, "restartApp", null));
        assertTrue(calls.contains("screen false"));
        assertTrue(calls.contains("volume 3"));
        assertTrue(calls.contains("restartApp"));
    }

    @Test public void aWrongOrMissingTokenDoesNothing() {
        assertEquals("", bridge.call("wrong", "restartApp", ""));
        assertEquals("", bridge.call(null, "restartApp", ""));
        assertEquals("", bridge.call(TOKEN.substring(1), "screen", "false"));
        assertTrue(calls.isEmpty());
    }

    @Test public void theRightTokenFromADisallowedPageDoesNothing() {
        url = "https://elsewhere.test/";
        assertEquals("", bridge.call(TOKEN, "restartApp", ""));
        url = "about:blank";
        assertEquals("", bridge.call(TOKEN, "launch", "{\"package\":\"ok\"}"));
        assertTrue(calls.isEmpty());
    }

    @Test public void backModeIsValidatedAndUnknownMethodsAreIgnored() {
        bridge.call(TOKEN, "setBackMode", "reload");
        bridge.call(TOKEN, "setBackMode", "sideways");
        assertEquals("", bridge.call(TOKEN, "formatDisk", ""));
        assertEquals(java.util.Arrays.asList("back reload"), calls);
    }

    @Test public void thePageCannotReachTheDebugToolsOrChangeASetting() {
        // The bridge is a fixed list. Running a script or a command, reading the screen or
        // the log, and writing a setting (debug.execEnabled above all) are not on it.
        for (String method : new String[] { "eval", "debugEval", "debug.eval", "exec", "debug.exec", "html", "screenshot", "logcat",
                "fps", "speak", "sound", "settings", "setSetting", "set", "getSetting", "unlock", "lockdown", "payload", "update" }) {
            assertEquals(method, "", bridge.call(TOKEN, method, "{\"key\":\"debug.execEnabled\",\"value\":true}"));
        }
        assertTrue(calls.isEmpty());
    }

    @Test public void aBadVolumeStreamFallsBackToMusic() {
        bridge.call(TOKEN, "volume", "loud");
        assertEquals(java.util.Arrays.asList("volume 3"), calls);
    }

    @Test public void anActionThatThrowsNeverReachesThePage() {
        BridgeDispatcher b = new BridgeDispatcher(tokens, OriginPolicy.fromSettings("", "https://app.example.test/"), () -> url,
                new BridgeDispatcher.Actions() {
                    @Override public String capabilitiesJson() { throw new IllegalStateException("boom"); }
                    @Override public boolean launch(String json) { throw new IllegalStateException("boom"); }
                    @Override public boolean screen(boolean on) { return false; }
                    @Override public void restartApp() { }
                    @Override public boolean reboot() { return false; }
                    @Override public void setBackMode(String mode) { }
                    @Override public String volumeJson(int stream) { return "{}"; }
                });
        assertEquals("", b.call(TOKEN, "capabilities", ""));
        assertEquals("", b.call(TOKEN, "launch", "{}"));
    }

    @Test public void thePageCannotUnlockTheKioskOrReachAnythingElse() {
        // Unlocking is POST /lockdown/unlock, behind the control token. The bridge has no way to it.
        for (String method : new String[] { "unlock", "lock", "lockdown", "lockdown.unlock", "lockdown/unlock",
                "allowFor", "allowWhileInFront", "settings", "exec", "eval", "input" }) {
            assertEquals(method, "", bridge.call(TOKEN, method, "{\"forMs\":60000}"));
        }
        assertTrue(calls.isEmpty());
        java.util.Set<String> actions = new java.util.TreeSet<>();
        for (java.lang.reflect.Method m : BridgeDispatcher.Actions.class.getDeclaredMethods()) actions.add(m.getName());
        assertEquals("the bridge does exactly what the contract lists",
                new java.util.TreeSet<>(java.util.Arrays.asList("capabilitiesJson", "launch", "screen", "restartApp",
                        "reboot", "setBackMode", "volumeJson")), actions);
    }

    // ── tokens belong to a document ──────────────────────────────────────────

    @Test public void aTokenCannotBeUsedAfterItsDocumentWasReplaced() {
        assertEquals("true", bridge.call(TOKEN, "screen", "false"));
        tokens.navigated();                      // a navigation replaces the document
        tokens.navigated();                      // and another
        calls.clear();
        assertEquals("", bridge.call(TOKEN, "restartApp", ""));
        assertEquals("", bridge.call(TOKEN, "launch", "{\"package\":\"ok\"}"));
        assertEquals("", bridge.call(TOKEN, "reboot", ""));
        assertTrue(calls.isEmpty());
        // The document that is showing now opens its own session.
        String fresh = bridge.open(KEY);
        assertEquals("true", bridge.call(fresh, "screen", "true"));
    }

    @Test public void theSessionKeyIsNotATokenAndAWrongKeyOpensNothing() {
        assertEquals("", bridge.call(KEY, "restartApp", ""));
        assertEquals("", bridge.open("wrong"));
        assertEquals("", bridge.open(null));
        assertTrue(calls.isEmpty());
    }

    @Test public void aTokenOpenedInsideAPageOfAnotherOriginDoesNothingThere() {
        // A frame of the allowed origin embedded in a hostile page holds the key (the shim
        // is injected by origin). It can open a session; every call is refused while the
        // main frame is that page.
        url = "https://elsewhere.test/";
        String framed = bridge.open(KEY);
        assertFalse(framed.isEmpty());
        assertEquals("", bridge.call(framed, "restartApp", ""));
        assertEquals("", bridge.call(framed, "launch", "{\"package\":\"ok\"}"));
        assertTrue(calls.isEmpty());
    }

    @Test public void aDocumentsFirstCallWorksBeforeTheMainThreadHasRecordedItsUrl() {
        // The first load: the bridge thread hears from the page before the main thread
        // has written down where the main frame is. Opening must not depend on that.
        url = "";
        String early = bridge.open(KEY);
        assertFalse("a refused open would leave the page with no bridge", early.isEmpty());
        url = "https://app.example.test/piano";            // the navigation callback arrives
        tokens.navigated();
        assertEquals("true", bridge.call(early, "screen", "true"));
    }
}
