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
    private boolean pinAvailable = true;
    private String pinAnswer = "{\"accepted\":true}";
    private long now = 1_000_000;

    @Before public void setUp() {
        BridgeDispatcher.Actions actions = new BridgeDispatcher.Actions() {
            @Override public String piano(String token, String method, String arg) { calls.add(method); return "ok"; }
            @Override public String capabilitiesJson() { calls.add("capabilities"); return "[\"webview-host\"]"; }
            @Override public boolean launch(String json) { calls.add("launch " + json); return json.contains("ok"); }
            @Override public boolean screen(boolean on) { calls.add("screen " + on); return true; }
            @Override public void restartApp() { calls.add("restartApp"); }
            @Override public boolean reboot() { calls.add("reboot"); return false; }
            @Override public void setBackMode(String mode) { calls.add("back " + mode); }
            @Override public String volumeJson(int stream) { calls.add("volume " + stream); return "{\"level\":40}"; }
            @Override public boolean canPinMedia() { return pinAvailable; }
            @Override public org.json.JSONObject pinMedia(String contentId, String label) {
                calls.add("pin " + contentId + " " + label);
                try { return new org.json.JSONObject(pinAnswer); } catch (Exception e) { throw new AssertionError(e); }
            }
        };
        tokens = new BridgeTokens(KEY);
        bridge = new BridgeDispatcher(tokens, OriginPolicy.fromSettings("", "https://app.example.test/"), () -> url, actions,
                new PinGate(() -> now));
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

    @Test public void pianoRequiresTrustedTopFrameOnLessonPath() {
        String top = bridge.open(KEY, "top");
        String child = bridge.open(KEY, "frame");
        for (String op : new String[]{"pianoSubscribe", "pianoRead", "pianoStatus", "pianoSend", "pianoUnsubscribe", "pianoRepair", "pianoRepairResult"}) {
            url = "https://app.example.test/piano/lesson";
            assertEquals("ok", bridge.call(top, op, ""));
            assertEquals("", bridge.call(child, op, ""));
            url = "https://app.example.test/pianola";
            assertEquals("", bridge.call(top, op, ""));
            url = "https://elsewhere.test/piano";
            assertEquals("", bridge.call(top, op, ""));
        }
    }

    @Test public void kioskToolsRequireTheCurrentDocumentAndTrustedTopFrame() {
        String top = bridge.open(KEY, "top");
        String frame = bridge.open(KEY, "frame");
        for (String op : new String[]{"pianoBluetoothState", "pianoBluetoothCommand", "pianoMidiTap", "pianoCheckVolume", "pianoWifi"}) {
            assertEquals("ok", bridge.call(top, op, ""));
            assertEquals("", bridge.call(frame, op, ""));
        }
        tokens.navigated();
        assertEquals("", bridge.call(top, "pianoBluetoothState", ""));
        String current = bridge.open(KEY, "top");
        url = "https://elsewhere.test/piano";
        assertEquals("", bridge.call(current, "pianoBluetoothState", ""));
        url = "https://app.example.test/elsewhere";
        assertEquals("", bridge.call(current, "pianoBluetoothState", ""));
    }

    @Test public void portalInputDiscardsBufferedKeysAndRepeatsAcrossStopReleaseNavigationAndRefocus() throws Exception {
        String doc = bridge.open(KEY, "top");
        PortalPageInput page = new PortalPageInput();
        page.attach(doc);
        final long[] revision = {0};
        net.kckern.daylight.core.spi.InputLock lock = new net.kckern.daylight.core.spi.InputLock() {
            public boolean active() { return revision[0] == 1; }
            public long revision() { return revision[0]; }
        };
        org.json.JSONObject frame = new org.json.JSONObject().put("key", "a");
        Object original = page.target(lock, tokens);
        assertTrue(page.offer(original, frame, lock, tokens));
        revision[0] = 1;
        assertEquals("[]", page.read(doc, lock));
        assertNull(page.target(lock, tokens));
        revision[0] = 2;
        assertFalse(page.offer(original, frame, lock, tokens));
        Object released = page.target(lock, tokens);
        assertTrue(page.offer(released, frame, lock, tokens));
        assertEquals("", page.read(bridge.open(KEY, "frame"), lock));
        assertEquals("a", new org.json.JSONArray(page.read(doc, lock)).getJSONObject(0).getString("key"));
        assertEquals("[]", page.read(doc, lock));
        page.clear();
        assertFalse(page.offer(released, frame, lock, tokens));
        tokens.navigated();
        assertNull(page.target(lock, tokens));
    }

    @Test public void pianoToolsProjectOnlyUiFieldsAndCannotDispatchOtherOperations() throws Exception {
        net.kckern.daylight.core.ServiceRegistry services = new net.kckern.daylight.core.ServiceRegistry();
        assertEquals("", PianoToolCalls.call(services, "pianoCheckVolume", ""));
        final org.json.JSONObject guard = new org.json.JSONObject().put("routeOk", true).put("musicIndex", 9)
                .put("musicMax", 15).put("privateDiagnostic", "unused");
        services.provide(net.kckern.daylight.core.spi.PianoKioskTools.Volume.class, () -> guard);
        org.json.JSONObject result = new org.json.JSONObject(PianoToolCalls.call(services, "pianoCheckVolume", ""));
        assertEquals(9, result.getJSONObject("guard").getInt("musicIndex"));
        assertFalse(result.toString().contains("privateDiagnostic"));
        services.provide(net.kckern.daylight.core.spi.PianoKioskTools.Bluetooth.class, (action, body) -> {
            assertEquals("pair", action);
            assertTrue(body.contains("address"));
            return new org.json.JSONObject(java.util.Collections.singletonMap("code", "permission_denied"));
        });
        assertEquals("", PianoToolCalls.call(services, "pianoBluetoothCommand", "{action:'settings',body:{}}"));
        String denied = PianoToolCalls.call(services, "pianoBluetoothCommand", "{action:'pair',body:{address:'fixture'}}");
        assertEquals("permission_denied", new org.json.JSONObject(denied).getString("code"));
    }

    @Test public void portalShimOffersDistinctVolumeAndKeyboardSubscriptions() {
        String shim = BridgeScript.shim(KEY, "p1", "portal");
        assertTrue(shim.contains("subscribeVolume"));
        assertTrue(shim.contains("subscribeKeyboard"));
    }

    @Test public void pianoRepairReturnsOnlyTheOwnersInstrumentVerdict() throws Exception {
        java.util.List<Runnable> jobs = new java.util.ArrayList<>();
        PianoRepair repair = new PianoRepair();
        net.kckern.daylight.core.spi.PianoOutput instrument = new net.kckern.daylight.core.spi.PianoOutput() {
            @Override public boolean send(byte[] bytes, long delay) { return false; }
            @Override public org.json.JSONObject repair() {
                try { return new org.json.JSONObject().put("fixed", true).put("recoveredAt", "L2")
                        .put("linkVerdict", "VERIFIED").put("privateDetail", "secret"); }
                catch (Exception failure) { throw new AssertionError(failure); }
            }
        };
        assertTrue(repair.start("new", instrument, jobs::add));
        assertFalse(repair.start("other", instrument, jobs::add));
        assertTrue(new org.json.JSONObject(repair.result("new")).getBoolean("pending"));
        jobs.get(0).run();
        assertEquals("", repair.result("old"));
        org.json.JSONObject result = new org.json.JSONObject(repair.result("new"));
        assertTrue(result.getBoolean("fixed"));
        assertEquals("L2", result.getString("recoveredAt"));
        assertEquals("VERIFIED", result.getString("linkVerdict"));
        assertEquals(3, result.length());
    }

    @Test public void pianoQueueAndSchedulerPreserveLessonData() throws Exception {
        int[] wakes = {0};
        PianoPage page = new PianoPage("private-document-id", () -> wakes[0]++);
        page.noteOn(62, 91, 1234, 9);
        page.controlChange(64, 127, 0);
        page.noteOff(62, 1240);
        String drained = page.drain();
        assertFalse(drained.contains("private-document-id"));
        org.json.JSONArray frames = new org.json.JSONArray(drained);
        assertEquals(3, frames.length());
        assertEquals(1234, frames.getJSONObject(0).getLong("t"));
        assertEquals(9, frames.getJSONObject(0).getInt("ch"));
        assertEquals(64, frames.getJSONObject(1).getInt("controller"));
        assertEquals("note.off", frames.getJSONObject(2).getString("type"));
        assertEquals("[]", page.drain());
        assertEquals(1, wakes[0]);
        assertTrue(PianoPage.send((bytes, delay) -> {
            assertArrayEquals(new byte[]{(byte)240, 65, (byte)247}, bytes);
            assertEquals(120, delay);
            return true;
        }, "{\"bytes\":[240,65,247],\"inMs\":120}"));
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
                        "reboot", "setBackMode", "volumeJson", "canPinMedia", "pinMedia", "piano", "portal")), actions);
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

    // ── pinMedia and canPinMedia: the threat cases ────────────────────────────

    private static final String PIN = "{\"contentId\":\"plex:12345\",\"label\":\"Morning music\"}";

    private String topToken() {
        String t = bridge.open(KEY, "top");
        assertFalse(t.isEmpty());
        return t;
    }

    private static org.json.JSONObject answer(String raw) throws Exception { return new org.json.JSONObject(raw); }

    @Test public void theTopFrameOfTheConfiguredOriginCanPinAndIsToldItWasAccepted() throws Exception {
        String top = topToken();
        assertEquals("true", bridge.call(top, "canPinMedia", ""));
        org.json.JSONObject r = answer(bridge.call(top, "pinMedia", PIN));
        assertTrue(r.getBoolean("accepted"));
        assertEquals(1, r.length());
        assertEquals(java.util.Collections.singletonList("pin plex:12345 Morning music"), calls);
    }

    @Test public void threat_anotherOriginInTheMainFrameGetsNoAnswerAndPinsNothing() {
        String top = topToken();
        url = "https://evil.example/";
        assertEquals("", bridge.call(top, "pinMedia", PIN));
        assertEquals("", bridge.call(top, "canPinMedia", ""));
        assertTrue(calls.isEmpty());
    }

    /** A cross-origin iframe has no key and so no token; an allowed-origin iframe has a token marked as a frame. */
    @Test public void threat_anIframeCannotPin() throws Exception {
        String frame = bridge.open(KEY, "frame");
        assertEquals("false", bridge.call(frame, "canPinMedia", ""));
        org.json.JSONObject r = answer(bridge.call(frame, "pinMedia", PIN));
        assertFalse(r.getBoolean("accepted"));
        assertEquals("not_top_frame", r.getString("reason"));
        assertEquals("a token opened without saying where it is counts as a frame", "not_top_frame",
                answer(bridge.call(TOKEN, "pinMedia", PIN)).getString("reason"));
        assertEquals("a guessed token is no token", "", bridge.call("0123456789abcdef0123456789abcdef", "pinMedia", PIN));
        assertTrue(calls.isEmpty());
    }

    @Test public void threat_aCallAfterNavigationWithAnOldTokenGetsNoAnswer() {
        String top = topToken();
        tokens.navigated();
        tokens.navigated();
        assertEquals("", bridge.call(top, "pinMedia", PIN));
        assertEquals("", bridge.call(top, "canPinMedia", ""));
        assertTrue(calls.isEmpty());
    }

    @Test public void threat_aRequestThatIsNotAnObjectOfTwoStringsIsABadRequest() throws Exception {
        String top = topToken();
        for (String bad : new String[] { "", "not json", "[]", "{}", "{\"contentId\":5,\"label\":\"x\"}",
                "{\"contentId\":\"plex:1\"}", "{\"label\":\"x\"}" }) {
            now += 10_000;
            assertEquals(bad, "bad_request", answer(bridge.call(top, "pinMedia", bad)).getString("reason"));
        }
        assertTrue(calls.isEmpty());
    }

    /** The content id and the label rules are media-service's; its reason comes back as it is. */
    @Test public void threat_aHostileLabelOrContentIdIsRefusedWithTheReasonMediaServiceGave() throws Exception {
        String top = topToken();
        pinAnswer = "{\"accepted\":false,\"reason\":\"invalid_label\"}";
        assertEquals("invalid_label", answer(bridge.call(top, "pinMedia",
                "{\"contentId\":\"plex:1\",\"label\":\"\\u202Eevil\"}")).getString("reason"));
        now += 10_000;
        pinAnswer = "{\"accepted\":false,\"reason\":\"invalid_content_id\"}";
        assertEquals("invalid_content_id", answer(bridge.call(top, "pinMedia",
                "{\"contentId\":\"https://evil.example/x\",\"label\":\"x\"}")).getString("reason"));
    }

    @Test public void threat_aFloodIsRefusedPastOneRequestInFiveSecondsAndCounted() throws Exception {
        String top = topToken();
        assertTrue(answer(bridge.call(top, "pinMedia", PIN)).getBoolean("accepted"));
        for (int i = 0; i < 9; i++) {
            now += 400;
            assertEquals("rate_limited", answer(bridge.call(top, "pinMedia", PIN)).getString("reason"));
        }
        assertEquals(9, bridge.pinRefusals());
        assertEquals("one dialog, not ten", 1, calls.size());
        now += 5_000;
        assertTrue("five seconds after the last accepted request", answer(bridge.call(top, "pinMedia", PIN)).getBoolean("accepted"));
        assertTrue("canPinMedia is a read and is not limited", "true".equals(bridge.call(top, "canPinMedia", "")));
    }

    @Test public void theLimitIsPerDocument() throws Exception {
        String a = topToken();
        assertTrue(answer(bridge.call(a, "pinMedia", PIN)).getBoolean("accepted"));
        tokens.navigated();
        url = "https://app.example.test/media";
        String b = topToken();
        assertTrue(answer(bridge.call(b, "pinMedia", PIN)).getBoolean("accepted"));
    }

    /** Whatever the native side answers, the page gets accepted and a reason: never a link, the key or the pinned list. */
    @Test public void threat_thePageCannotLearnTheKeyALinkOrThePinnedActions() throws Exception {
        String top = topToken();
        pinAnswer = "{\"accepted\":true,\"uri\":\"daylight://action/media-1#k=SECRETKEY\",\"pins\":[\"media-1\"],\"reason\":\"x\"}";
        String raw = bridge.call(top, "pinMedia", PIN);
        assertFalse(raw.contains("SECRETKEY"));
        assertFalse(raw.contains("daylight://"));
        assertFalse(raw.contains("media-1"));
        org.json.JSONObject r = answer(raw);
        assertEquals(1, r.length());
        assertTrue(r.getBoolean("accepted"));
        now += 10_000;
        pinAnswer = "{\"accepted\":false,\"reason\":\"daylight://action/x#k=SECRETKEY\"}";
        assertEquals("a reason that is not a plain word is not passed on", "failed",
                answer(bridge.call(top, "pinMedia", PIN)).getString("reason"));
        assertFalse(bridge.call(top, "capabilities", "").contains("SECRETKEY"));
    }

    @Test public void inABuildThatCannotPinNothingIsPinned() throws Exception {
        pinAvailable = false;
        String top = topToken();
        assertEquals("false", bridge.call(top, "canPinMedia", ""));
        pinAnswer = "{\"accepted\":false,\"reason\":\"not_available\"}";
        assertEquals("not_available", answer(bridge.call(top, "pinMedia", PIN)).getString("reason"));
    }
}
