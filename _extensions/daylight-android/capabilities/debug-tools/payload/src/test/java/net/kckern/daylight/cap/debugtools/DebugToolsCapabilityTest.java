package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.Intent;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.spi.KioskSurface;
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
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;

public class DebugToolsCapabilityTest {
    private static final byte[] PNG = { (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3 };
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private DebugToolsCapability cap;

    /** The kiosk page, scripted: each evaluate() takes the next reply. */
    private static final class FakePage implements KioskSurface {
        boolean attached = true;
        final List<String> scripts = new ArrayList<>();
        /** What the page's scripts return, in order. null = the page never answers (a timeout). */
        final Deque<String> replies = new ArrayDeque<>();
        byte[] png = PNG;
        RuntimeException captureFails;

        @Override public boolean attached() { return attached; }
        @Override public boolean inForeground() { return true; }
        @Override public String currentUrl() { return "https://kiosk.example/"; }
        @Override public Intent kioskIntent() { return null; }
        @Override public boolean bringToFront() { return true; }
        @Override public boolean startActivity(Intent intent) { return true; }
        @Override public synchronized String evaluate(String js, long timeoutMs) throws Exception {
            scripts.add(js);
            if (replies.isEmpty()) return "\"\"";
            String next = replies.poll();
            if ("TIMEOUT".equals(next)) throw new TimeoutException();
            // evaluateJavascript hands a script's string result back as a JSON string literal.
            return JSONObject.quote(next);
        }
        @Override public byte[] capturePng() { if (captureFails != null) throw captureFails; return png; }
        @Override public void setKeepScreenOn(boolean on) { }
        @Override public void setImmersive(boolean on) { }
        @Override public void setLockTask(boolean on) { }
        @Override public void observeTouches(TouchObserver observer) { }
        @Override public void promptPin(String title, PinCallback callback) { }
    }

    private static final class FakeSpeech implements DebugToolsCapability.Speech {
        final List<String> spoken = new ArrayList<>();
        boolean accept = true;
        int shutdowns;
        @Override public boolean speak(Context context, String text, String locale) { spoken.add(locale + "|" + text); return accept; }
        @Override public void shutdown() { shutdowns++; }
    }

    private static final class FakeSound implements DebugToolsCapability.Sound {
        final List<String> played = new ArrayList<>();
        boolean accept = true;
        int stops;
        @Override public boolean play(String url, boolean loop, int stream) { played.add(url + " loop=" + loop + " stream=" + stream); return accept; }
        @Override public void stop() { stops++; }
    }

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new DebugToolsCapability();
        assertEquals("debug-tools", cap.name());
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private JSONObject call(String method, String path, String body) throws Exception {
        return TestCore.call(core, method, path, null, body);
    }

    private Router.Response raw(String method, String path, Map<String, String> query) {
        return core.router().dispatch(method, path, FakeShell.TOKEN, query == null ? Collections.emptyMap() : query, null);
    }

    private static Map<String, String> query(String... pairs) {
        Map<String, String> q = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) q.put(pairs[i], pairs[i + 1]);
        return q;
    }

    private FakePage page() {
        FakePage page = new FakePage();
        core.services().provide(KioskSurface.class, page);
        return page;
    }

    /** Everything the app wrote down: the shell log's notes and the event ring behind GET /log. */
    private String everythingLogged() throws Exception {
        return ((FakeShell) core.shell()).notes + " " + call("GET", "/log", null).getJSONArray("events");
    }

    // ── the plan's tests ──────────────────────────────────────────────────────

    @Test public void theInfoRouteStillWorks() throws Exception {
        JSONObject o = call("GET", "/debug/info", null);
        assertEquals(200, o.getInt("_status"));
        assertEquals("test", o.getString("device"));
        assertTrue(o.has("sdkInt"));
    }

    @Test public void declaresItsSettingsAndEveryContractRoute() {
        assertEquals(Boolean.FALSE, core.settings().get("debug.execEnabled"));
        assertEquals(10000, core.settings().get("debug.execTimeoutMs"));
        assertEquals(5000, core.settings().get("debug.evalTimeoutMs"));
        assertEquals("", core.settings().get("debug.soundOrigins"));
        for (String route : new String[] { "GET /debug/screenshot", "POST /debug/eval", "GET /debug/html", "GET /debug/fps",
                "POST /debug/exec", "GET /debug/logcat", "POST /speak", "POST /sound" }) {
            assertTrue("missing " + route, core.router().routes().contains(route));
        }
    }

    @Test public void execIsUnsupportedUntilTheSettingIsTrue() throws Exception {
        JSONObject r = call("POST", "/debug/exec", "{\"cmd\":\"id\"}");
        assertEquals(501, r.getInt("_status"));
        assertEquals("unsupported", r.getString("error"));
        assertEquals("debug.execEnabled is false", r.getString("reason"));
        assertFalse("a refused command is not run and not written down as run", everythingLogged().contains("debug.exec"));
    }

    @Test public void execRunsWhenEnabledAndReportsTheExitCode() throws Exception {
        core.settings().set("debug.execEnabled", true);
        JSONObject r = call("POST", "/debug/exec", "{\"cmd\":\"echo hi; exit 2\"}");
        assertEquals(200, r.getInt("_status"));
        assertEquals(2, r.getInt("exitCode"));
        assertEquals("hi\n", r.getString("stdout"));
        assertEquals("", r.getString("stderr"));
        assertEquals(400, call("POST", "/debug/exec", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/debug/exec", "{\"cmd\":\"  \"}").getInt("_status"));
    }

    @Test public void pageToolsNeedTheWebViewHost() throws Exception {
        for (String[] c : new String[][] { { "POST", "/debug/eval", "{\"js\":\"1+1\"}" }, { "GET", "/debug/html", null },
                { "GET", "/debug/fps", null }, { "GET", "/debug/screenshot", null } }) {
            JSONObject r = call(c[0], c[1], c[2]);
            assertEquals(c[1], 501, r.getInt("_status"));
            assertEquals("capability 'webview-host' is not in this build", r.getString("reason"));
        }
    }

    @Test public void rejectsMalformedBodies() throws Exception {
        assertEquals(400, call("POST", "/debug/eval", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/speak", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/speak", "{\"text\":\"\"}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"file:///sdcard/x.mp3\"}").getInt("_status"));
    }

    // ── every route is behind the token, and none is reachable another way ────

    @Test public void everyRouteAnswers401WithoutTheToken() {
        String[][] routes = { { "GET", "/debug/screenshot" }, { "POST", "/debug/eval" }, { "GET", "/debug/html" }, { "GET", "/debug/fps" },
                { "POST", "/debug/exec" }, { "GET", "/debug/logcat" }, { "POST", "/speak" }, { "POST", "/sound" }, { "GET", "/debug/info" } };
        FakePage page = page();
        core.settings().set("debug.execEnabled", true);
        for (String[] r : routes) {
            for (String token : new String[] { null, "", "wrong-token" }) {
                assertEquals(r[1], 401, core.router().dispatch(r[0], r[1], token, Collections.emptyMap(), "{\"js\":\"1\",\"cmd\":\"id\"}").status);
            }
        }
        assertTrue("nothing reached the page", page.scripts.isEmpty());
    }

    @Test public void nothingOfDebugToolsIsReachableOverTheWebSocket() {
        // The socket's message types are the only things a socket client can ask for.
        assertTrue(core.socket().types().toString(), core.socket().types().isEmpty());
    }

    // ── exec ──────────────────────────────────────────────────────────────────

    @Test public void execHonoursItsTimeoutAndHoldsItToSixtySeconds() throws Exception {
        core.settings().set("debug.execEnabled", true);
        long t0 = System.currentTimeMillis();
        JSONObject r = call("POST", "/debug/exec", "{\"cmd\":\"sleep 30\",\"timeoutMs\":300}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("timedOut"));
        assertEquals(-1, r.getInt("exitCode"));
        assertTrue(System.currentTimeMillis() - t0 < 10_000);
        for (String bad : new String[] { "60001", "99", "0", "-1", "\"soon\"", "true" }) {
            assertEquals("timeoutMs " + bad, 400, call("POST", "/debug/exec", "{\"cmd\":\"id\",\"timeoutMs\":" + bad + "}").getInt("_status"));
        }
        for (String bad : new String[] { "60001", "99" }) {
            assertEquals(400, call("POST", "/settings", "{\"key\":\"debug.execTimeoutMs\",\"value\":" + bad + "}").getInt("_status"));
        }
        assertEquals(400, call("POST", "/debug/exec", "{\"cmd\":42}").getInt("_status"));
    }

    @Test public void execOutputIsCappedAndSaysSo() throws Exception {
        core.settings().set("debug.execEnabled", true);
        JSONObject r = call("POST", "/debug/exec", "{\"cmd\":\"head -c 400000 /dev/zero | tr '\\\\0' 'a'\"}");
        assertEquals(0, r.getInt("exitCode"));
        assertTrue(r.getBoolean("stdoutTruncated"));
        assertFalse(r.getBoolean("stderrTruncated"));
        assertTrue(r.getString("stdout").endsWith(ShellExec.TRUNCATED));
        assertEquals(ShellExec.MAX_BYTES + ShellExec.TRUNCATED.length(), r.getString("stdout").length());
    }

    @Test public void execWritesDownTheCommandAndItsExitCodeAndNeverItsOutput() throws Exception {
        core.settings().set("debug.execEnabled", true);
        final List<JSONObject> shipped = new ArrayList<>();
        cap.useLogStoreForTest((event, level, data) -> { if (event.equals("debug.exec")) shipped.add(data); });
        JSONObject r = call("POST", "/debug/exec", "{\"cmd\":\"echo $((40+2))00; echo $((50+5))00 1>&2; exit 4\"}");
        assertEquals("4200\n", r.getString("stdout"));
        assertEquals("5500\n", r.getString("stderr"));
        String logged = everythingLogged();
        assertTrue(logged, logged.contains("echo $((40+2))00"));
        assertTrue(logged, logged.contains("exit=4"));
        assertFalse("stdout is not logged", logged.contains("4200"));
        assertFalse("stderr is not logged", logged.contains("5500"));
        assertEquals("shipped to the log store once", 1, shipped.size());
        assertEquals(4, shipped.get(0).getInt("exitCode"));
        assertTrue(shipped.get(0).getString("cmd").startsWith("echo $((40+2))00"));
        assertFalse(shipped.get(0).toString().contains("4200") || shipped.get(0).toString().contains("5500"));
        assertFalse(shipped.get(0).has("stdout") || shipped.get(0).has("stderr"));
    }

    @Test public void aLongCommandIsLoggedCutToTwoHundredCharacters() throws Exception {
        core.settings().set("debug.execEnabled", true);
        StringBuilder cmd = new StringBuilder("true");
        for (int i = 0; i < 100; i++) cmd.append(" # padding");
        call("POST", "/debug/exec", new JSONObject().put("cmd", cmd.toString()).toString());
        for (String note : ((FakeShell) core.shell()).notes) assertTrue(note.length() < 260);
    }

    // ── eval ──────────────────────────────────────────────────────────────────

    @Test public void evalReturnsThePagesValue() throws Exception {
        FakePage page = page();
        page.replies.add("{\"v\":{\"title\":\"Piano\"}}");
        JSONObject r = call("POST", "/debug/eval", "{\"js\":\"({title: document.title})\"}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("ok"));
        assertEquals("Piano", r.getJSONObject("result").getString("title"));
        assertEquals(1, page.scripts.size());
        assertTrue(page.scripts.get(0).contains("(0,eval)("));
        page.replies.add("{\"v\":null}");
        assertTrue(call("POST", "/debug/eval", "{\"js\":\"void 0\"}").isNull("result"));
    }

    @Test public void evalWaitsForAPromiseByPolling() throws Exception {
        FakePage page = page();
        page.replies.add("{\"pending\":1}");
        page.replies.add("");
        page.replies.add("{\"v\":200}");
        JSONObject r = call("POST", "/debug/eval", "{\"js\":\"fetch('/x').then(r => r.status)\"}");
        assertEquals(200, r.getInt("result"));
        assertEquals("the wrapped source, then two polls", 3, page.scripts.size());
        assertTrue(page.scripts.get(2).contains("delete s[id]"));
    }

    @Test public void aScriptErrorIsReportedAsJsError() throws Exception {
        FakePage page = page();
        page.replies.add("{\"e\":\"nope is not defined\"}");
        JSONObject r = call("POST", "/debug/eval", "{\"js\":\"nope(\"}");
        assertFalse(r.getBoolean("ok"));
        assertEquals("js_error", r.getString("error"));
        assertEquals("nope is not defined", r.getString("message"));
    }

    @Test public void evalHonoursItsTimeoutAnswers408AndCleansUpThePage() throws Exception {
        FakePage page = page();
        page.replies.add("{\"pending\":1}");      // then nothing: every poll says "not yet"
        long t0 = System.currentTimeMillis();
        JSONObject r = call("POST", "/debug/eval", "{\"js\":\"new Promise(() => {})\",\"timeoutMs\":200}");
        long took = System.currentTimeMillis() - t0;
        assertEquals(408, r.getInt("_status"));
        assertEquals("timeout", r.getString("error"));
        assertTrue("took " + took, took >= 200 && took < 3000);
        String last = page.scripts.get(page.scripts.size() - 1);
        assertTrue("the parked slot is removed", last.contains("delete s[id]") && last.contains("cancelAnimationFrame"));

        // A page that does not answer at all (a busy loop) is a timeout too.
        page.replies.add("TIMEOUT");
        assertEquals(408, call("POST", "/debug/eval", "{\"js\":\"for(;;){}\",\"timeoutMs\":100}").getInt("_status"));
    }

    @Test public void evalTimeoutsAndBodiesAreValidated() throws Exception {
        FakePage page = page();
        for (String bad : new String[] { "99", "60001", "\"long\"", "-5" }) {
            assertEquals("timeoutMs " + bad, 400, call("POST", "/debug/eval", "{\"js\":\"1\",\"timeoutMs\":" + bad + "}").getInt("_status"));
        }
        assertEquals(400, call("POST", "/debug/eval", "{\"js\":5}").getInt("_status"));
        assertEquals(400, call("POST", "/debug/eval", "{\"js\":\"\"}").getInt("_status"));
        assertEquals(400, call("POST", "/debug/eval", "not json").getInt("_status"));
        assertEquals(400, call("POST", "/settings", "{\"key\":\"debug.evalTimeoutMs\",\"value\":60001}").getInt("_status"));
        assertTrue("a refused request runs nothing in the page", page.scripts.isEmpty());
    }

    @Test public void aResultOverOneMebibyteIsRefusedWithItsSize() throws Exception {
        FakePage page = page();
        page.replies.add("{\"big\":2000000}");
        JSONObject r = call("POST", "/debug/eval", "{\"js\":\"'x'.repeat(2e6)\"}");
        assertEquals(413, r.getInt("_status"));
        assertEquals("result_too_large", r.getString("error"));
        assertEquals(2_000_000, r.getInt("size"));
        assertEquals(1024 * 1024, r.getInt("max"));
        assertTrue("the cap is in the script the page ran", page.scripts.get(0).contains("t.length>1048576"));
    }

    @Test public void evalLogsThatItRanItsDurationAndSizeAndNeverTheScriptOrTheResult() throws Exception {
        FakePage page = page();
        final List<String> shipped = new ArrayList<>();
        cap.useLogStoreForTest((event, level, data) -> shipped.add(event + " " + data));
        page.replies.add("{\"v\":\"household-page-data\"}");
        call("POST", "/debug/eval", "{\"js\":\"document.querySelector('#secret-selector').textContent\"}");
        page.replies.add("{\"e\":\"error-text-from-the-page\"}");
        call("POST", "/debug/eval", "{\"js\":\"throwing-script()\"}");
        String logged = everythingLogged() + " " + shipped;
        for (String leak : new String[] { "household-page-data", "secret-selector", "error-text-from-the-page", "throwing-script" }) {
            assertFalse(leak + " was logged", logged.contains(leak));
        }
        assertEquals(2, shipped.size());
        JSONObject first = new JSONObject(shipped.get(0).substring("debug.eval ".length()));
        assertTrue(shipped.get(0).startsWith("debug.eval "));
        assertEquals("ok", first.getString("outcome"));
        assertTrue(first.has("ms"));
        assertEquals("the size of the result's JSON text", "\"household-page-data\"".length(), first.getInt("resultChars"));
        assertTrue(shipped.get(1).contains("js_error"));
        assertTrue(call("GET", "/log", null).getJSONArray("events").toString().contains("debug.eval"));
    }

    @Test public void withNoKioskWindowThePageToolsSaySo() throws Exception {
        FakePage page = page();
        page.attached = false;
        for (String[] c : new String[][] { { "POST", "/debug/eval", "{\"js\":\"1+1\"}" }, { "GET", "/debug/html", null },
                { "GET", "/debug/fps", null }, { "GET", "/debug/screenshot", null } }) {
            JSONObject r = call(c[0], c[1], c[2]);
            assertFalse(c[1], r.getBoolean("ok"));
            assertEquals(c[1], "no_kiosk_activity", r.getString("error"));
        }
        assertTrue(page.scripts.isEmpty());
    }

    // ── html ──────────────────────────────────────────────────────────────────

    @Test public void htmlReturnsTheDocumentAndLogsOnlyItsSize() throws Exception {
        FakePage page = page();
        final List<String> shipped = new ArrayList<>();
        cap.useLogStoreForTest((event, level, data) -> shipped.add(event));
        page.replies.add(new JSONObject().put("v", "<html><body>family-calendar</body></html>").toString());
        JSONObject r = call("GET", "/debug/html", null);
        assertEquals(200, r.getInt("_status"));
        assertEquals("<html><body>family-calendar</body></html>", r.getString("html"));
        assertTrue(page.scripts.get(0).contains("document.documentElement.outerHTML"));
        assertFalse(everythingLogged().contains("family-calendar"));
        assertTrue("what is on screen is never shipped to the log store", shipped.isEmpty());

        page.replies.add("{\"big\":99000000}");
        assertEquals(413, call("GET", "/debug/html", null).getInt("_status"));
    }

    // ── fps ───────────────────────────────────────────────────────────────────

    @Test public void fpsSamplesTheLivePageWithoutReloadingIt() throws Exception {
        FakePage page = page();
        page.replies.add("{\"pending\":1}");
        page.replies.add("");
        page.replies.add("{\"v\":{\"frames\":58,\"ms\":1003,\"fps\":58,\"visible\":\"visible\"}}");
        Router.Response raw = raw("GET", "/debug/fps", query("ms", "100"));
        JSONObject r = new JSONObject(new String(raw.body, StandardCharsets.UTF_8));
        assertEquals(200, raw.status);
        assertTrue(r.getBoolean("ok"));
        assertEquals(58, r.getInt("fps"));
        assertEquals(58, r.getInt("frames"));
        assertEquals(1003, r.getInt("ms"));
        assertEquals("visible", r.getString("visible"));
        assertTrue(page.scripts.get(0).contains("requestAnimationFrame"));
        assertTrue(page.scripts.get(0).contains("<100)"));
        for (String script : page.scripts) {
            assertFalse(script.contains("location"));
            assertFalse(script.contains("reload"));
            assertFalse("nothing is added to the document", script.contains("createElement") || script.contains("appendChild"));
        }
    }

    @Test public void fpsWithNoFramesTimesOutSaysWhyAndRemovesItsProbe() throws Exception {
        FakePage page = page();
        cap.fpsGraceMs = 200;
        page.replies.add("{\"pending\":1}");
        Router.Response raw = raw("GET", "/debug/fps", query("ms", "100"));
        JSONObject r = new JSONObject(new String(raw.body, StandardCharsets.UTF_8));
        assertEquals(408, raw.status);
        assertEquals("timeout", r.getString("error"));
        assertTrue(r.getString("message"), r.getString("message").contains("display"));
        String last = page.scripts.get(page.scripts.size() - 1);
        assertTrue("its pending frame request is cancelled", last.contains("cancelAnimationFrame") && last.contains("delete s[id]"));
    }

    @Test public void fpsDurationIsAWholeNumberHeldToItsRange() throws Exception {
        FakePage page = page();
        assertEquals(400, raw("GET", "/debug/fps", query("ms", "soon")).status);
        page.replies.add("{\"v\":{\"frames\":1,\"ms\":10000,\"fps\":0,\"visible\":\"visible\"}}");
        raw("GET", "/debug/fps", query("ms", "999999"));
        assertTrue("held to ten seconds", page.scripts.get(0).contains("<10000)"));
    }

    // ── screenshot ────────────────────────────────────────────────────────────

    @Test public void screenshotReturnsThePngBytesAndLogsOnlyTheirCount() throws Exception {
        page();
        final List<String> shipped = new ArrayList<>();
        cap.useLogStoreForTest((event, level, data) -> shipped.add(event));
        Router.Response r = raw("GET", "/debug/screenshot", null);
        assertEquals(200, r.status);
        assertEquals("image/png", r.contentType);
        assertArrayEquals(PNG, r.body);
        assertTrue("what is on screen is never shipped to the log store", shipped.isEmpty());
        assertTrue(everythingLogged().contains("debug.screenshot bytes=" + PNG.length));
    }

    @Test public void aCaptureThatFailsOrIsNotAPngIsAnErrorNotAnImage() throws Exception {
        FakePage page = page();
        page.png = "not a png at all".getBytes(StandardCharsets.UTF_8);
        JSONObject notPng = call("GET", "/debug/screenshot", null);
        assertEquals(500, notPng.getInt("_status"));
        assertEquals("capture_failed", notPng.getString("error"));
        page.png = null;
        assertEquals("capture_failed", call("GET", "/debug/screenshot", null).getString("error"));
        page.captureFails = new IllegalStateException("no page to capture");
        JSONObject failed = call("GET", "/debug/screenshot", null);
        assertEquals(500, failed.getInt("_status"));
        assertEquals("capture_failed", failed.getString("error"));
        assertEquals("no page to capture", failed.getString("message"));
    }

    // ── logcat ────────────────────────────────────────────────────────────────

    private static final String LOG = "11-16 10:00:00 I/Daylight-Kiosk: attached\n11-16 10:00:01 W/chromium: slow\n";

    private static JSONObject logResult(String stdout) {
        try { return new JSONObject().put("ok", true).put("exit", 0).put("stdout", stdout).put("stderr", ""); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    @Test public void logcatIsPlainTextFilteredHereAndSaysWhoseLinesItHolds() {
        final List<Integer> asked = new ArrayList<>();
        cap.useLogsForTest(lines -> { asked.add(lines); return logResult(LOG); }, context -> false);
        Router.Response all = raw("GET", "/debug/logcat", null);
        assertEquals(200, all.status);
        assertEquals("text/plain", all.contentType);
        assertEquals(LOG, new String(all.body, StandardCharsets.UTF_8));
        assertEquals("without READ_LOGS the answer says it holds this app's lines only", "own", all.headers.get("X-Daylight-Log-Scope"));

        Router.Response some = raw("GET", "/debug/logcat", query("lines", "200", "filter", "DAYLIGHT"));
        assertEquals("11-16 10:00:00 I/Daylight-Kiosk: attached\n", new String(some.body, StandardCharsets.UTF_8));
        assertEquals(java.util.Arrays.asList(500, 200), asked);

        cap.useLogsForTest(lines -> logResult(LOG), context -> true);
        assertEquals("all", raw("GET", "/debug/logcat", null).headers.get("X-Daylight-Log-Scope"));
    }

    @Test public void logcatValidatesItsLineCountAndFilter() {
        final List<Integer> asked = new ArrayList<>();
        cap.useLogsForTest(lines -> { asked.add(lines); return logResult(LOG); }, context -> false);
        for (String bad : new String[] { "0", "5001", "-1", "many", "5; id", "$(id)" }) {
            assertEquals("lines " + bad, 400, raw("GET", "/debug/logcat", query("lines", bad)).status);
        }
        StringBuilder longFilter = new StringBuilder();
        for (int i = 0; i < 201; i++) longFilter.append('a');
        assertEquals(400, raw("GET", "/debug/logcat", query("filter", longFilter.toString())).status);
        assertEquals(400, raw("GET", "/debug/logcat", query("filter", "a\nb")).status);
        assertTrue("nothing was read for a refused request", asked.isEmpty());
        // A filter is text, whatever it looks like: it selects lines and reaches no command.
        Router.Response r = raw("GET", "/debug/logcat", query("filter", "; rm -rf / #"));
        assertEquals(200, r.status);
        assertEquals(0, r.body.length);
    }

    @Test public void aLogReadThatFailsIsAnErrorNotAnEmptyLog() throws Exception {
        final JSONObject failure = new JSONObject().put("ok", false).put("error", "Cannot run program");
        cap.useLogsForTest(lines -> failure, context -> false);
        Router.Response r = raw("GET", "/debug/logcat", null);
        assertEquals(500, r.status);
        assertEquals("logcat_failed", new JSONObject(new String(r.body, StandardCharsets.UTF_8)).getString("error"));
    }

    // ── speak ─────────────────────────────────────────────────────────────────

    @Test public void speakQueuesTheTextAndNeverLogsIt() throws Exception {
        FakeSpeech speech = new FakeSpeech();
        cap.useSpeechForTest(speech);
        JSONObject r = call("POST", "/speak", "{\"text\":\"dinner is ready\",\"locale\":\"en-US\"}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("queued"));
        assertEquals(Collections.singletonList("en-US|dinner is ready"), speech.spoken);
        assertFalse(everythingLogged().contains("dinner is ready"));
        call("POST", "/speak", "{\"text\":\"hello\"}");
        assertEquals("|hello", speech.spoken.get(1));

        speech.accept = false;
        JSONObject refused = call("POST", "/speak", "{\"text\":\"hello\"}");
        assertFalse(refused.getBoolean("ok"));
        assertFalse(refused.getBoolean("queued"));
        assertEquals("speak_refused", refused.getString("error"));
    }

    @Test public void speakValidatesItsTextAndLocale() throws Exception {
        FakeSpeech speech = new FakeSpeech();
        cap.useSpeechForTest(speech);
        StringBuilder longText = new StringBuilder();
        for (int i = 0; i <= DebugToolsCapability.MAX_SPEAK_CHARS; i++) longText.append('a');
        assertEquals(400, call("POST", "/speak", new JSONObject().put("text", longText.toString()).toString()).getInt("_status"));
        assertEquals(400, call("POST", "/speak", "{\"text\":5}").getInt("_status"));
        assertEquals(400, call("POST", "/speak", "{\"text\":\"   \"}").getInt("_status"));
        for (String bad : new String[] { "\"en_US; id\"", "\"x\"", "5", "\"../../etc\"" }) {
            assertEquals("locale " + bad, 400, call("POST", "/speak", "{\"text\":\"hi\",\"locale\":" + bad + "}").getInt("_status"));
        }
        assertTrue(speech.spoken.isEmpty());
    }

    @Test public void speakAndSoundAreUnsupportedBeforeThePayloadHasAContext() throws Exception {
        // The real engines need Android; no test engine is installed here.
        JSONObject speak = call("POST", "/speak", "{\"text\":\"hi\"}");
        assertEquals(501, speak.getInt("_status"));
        core.settings().set("debug.soundOrigins", "*");
        assertEquals(501, call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\"}").getInt("_status"));
    }

    // ── sound ─────────────────────────────────────────────────────────────────

    private FakeSound soundOnAKiosk() {
        core.settings().declare("webview.startUrl", Type.STRING, "https://kiosk.example/piano");
        core.settings().declare("webview.bridgeOrigins", Type.STRING, "https://app.example");
        FakeSound sound = new FakeSound();
        cap.useSoundForTest(sound);
        return sound;
    }

    @Test public void soundPlaysAUrlFromAnOriginTheKioskTrusts() throws Exception {
        FakeSound sound = soundOnAKiosk();
        JSONObject r = call("POST", "/sound", "{\"url\":\"https://kiosk.example/media/chime.mp3\"}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("playing"));
        call("POST", "/sound", "{\"url\":\"https://app.example/a.mp3\",\"loop\":true,\"stream\":4}");
        assertEquals(java.util.Arrays.asList("https://kiosk.example/media/chime.mp3 loop=false stream=3",
                "https://app.example/a.mp3 loop=true stream=4"), sound.played);

        JSONObject stopped = call("POST", "/sound", "{\"stop\":true}");
        assertTrue(stopped.getBoolean("ok"));
        assertFalse(stopped.getBoolean("playing"));
        assertEquals(1, sound.stops);

        sound.accept = false;
        JSONObject failed = call("POST", "/sound", "{\"url\":\"https://kiosk.example/missing.mp3\"}");
        assertFalse(failed.getBoolean("ok"));
        assertEquals("sound_failed", failed.getString("error"));
        assertFalse(failed.getBoolean("playing"));
    }

    @Test public void soundRefusesLocalFilesOtherSchemesAndOriginsItDoesNotTrust() throws Exception {
        FakeSound sound = soundOnAKiosk();
        for (String url : new String[] { "file:///sdcard/x.mp3", "content://media/external/audio/1", "/data/x.mp3",
                "https://elsewhere.example/a.mp3", "http://kiosk.example/a.mp3", "javascript:alert(1)", "" }) {
            JSONObject r = call("POST", "/sound", new JSONObject().put("url", url).toString());
            assertEquals(url, 400, r.getInt("_status"));
            assertEquals("bad_request", r.getString("error"));
        }
        assertEquals(400, call("POST", "/sound", "{\"url\":5}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\",\"stream\":11}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\",\"stream\":-1}").getInt("_status"));
        assertTrue("nothing was handed to the player", sound.played.isEmpty());
    }

    @Test public void aSettingWidensWhatSoundMayFetchButNeverPastHttp() throws Exception {
        FakeSound sound = soundOnAKiosk();
        core.settings().set("debug.soundOrigins", "https://elsewhere.example");
        assertEquals(200, call("POST", "/sound", "{\"url\":\"https://elsewhere.example/a.mp3\"}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"https://third.example/a.mp3\"}").getInt("_status"));
        core.settings().set("debug.soundOrigins", "*");
        assertEquals(200, call("POST", "/sound", "{\"url\":\"https://third.example/a.mp3\"}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"file:///sdcard/x.mp3\"}").getInt("_status"));
        assertEquals(400, call("POST", "/sound", "{\"url\":\"content://media/1\"}").getInt("_status"));
        assertEquals(2, sound.played.size());
    }

    @Test public void onADeviceWithNoKioskOnlyTheSettingAllowsASound() throws Exception {
        FakeSound sound = new FakeSound();
        cap.useSoundForTest(sound);       // webview.* settings are not declared in this build
        assertEquals(400, call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\"}").getInt("_status"));
        core.settings().set("debug.soundOrigins", "https://kiosk.example");
        assertEquals(200, call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\"}").getInt("_status"));
    }

    // ── a real start, over a fake Android context ─────────────────────────────

    @Test public void aRealStartTakesItsContextAndStopReleasesTheEnginesTwiceOver() throws Exception {
        cap.stop();
        File dir = tmp.newFolder();
        FakeContext ctx = new FakeContext(dir);
        core = TestCore.createWithContext(dir, ctx);
        cap = new DebugToolsCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set("debug.soundOrigins", "https://kiosk.example");
        FakeSpeech speech = new FakeSpeech();
        FakeSound sound = new FakeSound();
        cap.useSpeechForTest(speech);
        cap.useSoundForTest(sound);

        cap.start();
        assertTrue("started: the capability holds the context its engines need", cap.started());
        assertEquals("nothing is registered with Android by a start", 0, ctx.registered);
        assertTrue(call("POST", "/speak", "{\"text\":\"hi\"}").getBoolean("queued"));
        assertTrue(call("POST", "/sound", "{\"url\":\"https://kiosk.example/a.mp3\"}").getBoolean("playing"));

        cap.stop();
        assertFalse(cap.started());
        assertEquals("the speech engine is shut down", 1, speech.shutdowns);
        assertEquals("the sound is stopped", 1, sound.stops);
        cap.stop();
        assertEquals("a second stop finds nothing left to release", 1, speech.shutdowns);
        assertEquals(1, sound.stops);
        assertFalse(cap.started());
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() {
        cap.start();
        assertFalse(cap.started());
        cap.stop();
        cap.stop();
    }
}
