package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class BridgeDispatcherTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
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
        bridge = new BridgeDispatcher(TOKEN, OriginPolicy.fromSettings("", "https://app.example.test/"), () -> url, actions);
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

    @Test public void aBadVolumeStreamFallsBackToMusic() {
        bridge.call(TOKEN, "volume", "loud");
        assertEquals(java.util.Arrays.asList("volume 3"), calls);
    }

    @Test public void anActionThatThrowsNeverReachesThePage() {
        BridgeDispatcher b = new BridgeDispatcher(TOKEN, OriginPolicy.fromSettings("", "https://app.example.test/"), () -> url,
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
}
