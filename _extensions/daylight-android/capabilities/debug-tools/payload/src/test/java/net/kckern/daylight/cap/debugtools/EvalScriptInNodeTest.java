package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Runs the generated scripts in a real JavaScript engine (Node, which the build already
 * needs for the port check), against a stand-in for the page's window. The string tests
 * in EvalScriptTest say what the scripts contain; these say what they do.
 */
public class EvalScriptInNodeTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @BeforeClass public static void nodeIsOnThePath() throws Exception {
        Process p = new ProcessBuilder("node", "--version").redirectErrorStream(true).start();
        assertTrue("node did not answer", p.waitFor(20, TimeUnit.SECONDS));
        assertEquals("node --version", 0, p.exitValue());
    }

    /** A page: a global object with the few things the scripts touch, and frames that run only when pumped. */
    private static final String PAGE = String.join("\n",
            "globalThis.window = globalThis;",
            "globalThis.document = { visibilityState: 'visible' };",
            "let frames = [], nextFrame = 0;",
            "globalThis.requestAnimationFrame = (f) => { frames.push([++nextFrame, f]); return nextFrame; };",
            "globalThis.cancelAnimationFrame = (id) => { frames = frames.filter((x) => x[0] !== id); };",
            "const pump = () => { const due = frames; frames = []; for (const [, f] of due) f(); };",
            "const run = (js) => (0, eval)(js);",
            "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
            "const say = (name, value) => console.log(JSON.stringify({ name, value }));",
            "const holder = () => typeof globalThis.__dlEval;",
            "");

    private JSONObject node(String body) throws Exception {
        File script = new File(tmp.getRoot(), "page-" + System.nanoTime() + ".js");
        Files.write(script.toPath(), (PAGE + "(async () => {\n" + body + "\n})().catch((e) => { console.error(e); process.exit(1); });\n")
                .getBytes(StandardCharsets.UTF_8));
        Process p = new ProcessBuilder("node", script.getAbsolutePath()).redirectErrorStream(true).start();
        byte[] out = p.getInputStream().readAllBytes();
        assertTrue(p.waitFor(30, TimeUnit.SECONDS));
        String text = new String(out, StandardCharsets.UTF_8);
        assertEquals(text, 0, p.exitValue());
        JSONObject results = new JSONObject();
        for (String line : text.split("\n")) {
            if (line.trim().isEmpty()) continue;
            JSONObject o = new JSONObject(line);
            results.put(o.getString("name"), o.opt("value"));
        }
        return results;
    }

    private static String q(String js) { return JSONObject.quote(js); }

    /** What the app would make of a script's return value: evaluateJavascript hands it back JSON-encoded. */
    private static JSONObject envelope(JSONObject results, String name) throws Exception {
        return EvalScript.parse(JSONObject.quote(results.getString(name)));
    }

    @Test public void aPlainValueComesBackAndLeavesNothingInThePage() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('sum', run(" + q(EvalScript.wrap("1+1", "a1")) + "));",
                "say('none', run(" + q(EvalScript.wrap("undefined", "a2")) + "));",
                "say('state', run(" + q(EvalScript.wrap("document.visibilityState", "a3")) + "));",
                "say('holder', holder());"));
        assertEquals(2, envelope(r, "sum").getInt("v"));
        assertTrue(envelope(r, "none").isNull("v"));
        assertEquals("visible", envelope(r, "state").getString("v"));
        assertEquals("undefined", r.getString("holder"));
    }

    @Test public void aSyntaxErrorOrAThrowIsReportedAsText() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('syntax', run(" + q(EvalScript.wrap("nope(", "a1")) + "));",
                "say('thrown', run(" + q(EvalScript.wrap("throw new Error('boom')", "a2")) + "));",
                "say('holder', holder());"));
        assertTrue(envelope(r, "syntax").has("e"));
        assertEquals("boom", envelope(r, "thrown").getString("e"));
        assertEquals("undefined", r.getString("holder"));
    }

    @Test public void aPromiseIsParkedPolledReadOnceAndRemoved() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('first', run(" + q(EvalScript.wrap("new Promise((res) => setTimeout(() => res({a:1}), 30))", "a1")) + "));",
                "say('early', run(" + q(EvalScript.poll("a1")) + "));",
                "await sleep(80);",
                "say('ready', run(" + q(EvalScript.poll("a1")) + "));",
                "say('again', run(" + q(EvalScript.poll("a1")) + "));",
                "say('rejected', run(" + q(EvalScript.wrap("Promise.reject(new Error('nope'))", "a2")) + "));",
                "await sleep(10);",
                "say('rejection', run(" + q(EvalScript.poll("a2")) + "));",
                "say('holder', holder());"));
        assertTrue(envelope(r, "first").has("pending"));
        assertEquals("still pending reads as nothing yet", "", r.getString("early"));
        assertEquals(1, envelope(r, "ready").getJSONObject("v").getInt("a"));
        assertTrue("a result is read once", envelope(r, "again").has("e"));
        assertEquals("nope", envelope(r, "rejection").getString("e"));
        assertEquals("undefined", r.getString("holder"));
    }

    @Test public void aResultOverTheCapIsReplacedByItsSizeBeforeItLeavesThePage() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('big', run(" + q(EvalScript.wrap("'x'.repeat(500)", "a1", 100)) + "));",
                "say('fits', run(" + q(EvalScript.wrap("'x'.repeat(50)", "a2", 100)) + "));",
                "say('parked', run(" + q(EvalScript.wrap("Promise.resolve('y'.repeat(500))", "a3", 100)) + "));",
                "await sleep(10);",
                "say('bigLater', run(" + q(EvalScript.poll("a3", 100)) + "));",
                "say('holder', holder());"));
        assertEquals(508, envelope(r, "big").getInt("big"));          // {"v":"xxx…"} is 500 + 8 characters
        assertFalse(r.getString("big").contains("xxx"));
        assertEquals(50, envelope(r, "fits").getString("v").length());
        assertEquals(508, envelope(r, "bigLater").getInt("big"));
        assertEquals("undefined", r.getString("holder"));
    }

    @Test public void aTimedOutEvalIsCleanedUpAndALateSettleWritesNothing() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('first', run(" + q(EvalScript.wrap("new Promise((res) => setTimeout(() => res('late'), 40))", "a1")) + "));",
                "say('cleanup', run(" + q(EvalScript.cleanup("a1")) + "));",
                "say('holderAfterCleanup', holder());",
                "await sleep(90);",
                "say('holderAfterSettle', holder());",
                "say('twice', run(" + q(EvalScript.cleanup("a1")) + "));"));
        assertEquals("", r.getString("cleanup"));
        assertEquals("undefined", r.getString("holderAfterCleanup"));
        assertEquals("undefined", r.getString("holderAfterSettle"));
        assertEquals("", r.getString("twice"));
    }

    @Test public void theFpsProbeCountsFramesAndRemovesItself() throws Exception {
        JSONObject r = node(String.join("\n",
                "say('start', run(" + q(EvalScript.fpsProbe(100, "f1")) + "));",
                "say('early', run(" + q(EvalScript.poll("f1")) + "));",
                "const t0 = Date.now(); let pumps = 0;",
                "while (Date.now() - t0 < 300) { pump(); pumps++; await sleep(10); }",
                "say('pumps', pumps);",
                "say('result', run(" + q(EvalScript.poll("f1")) + "));",
                "say('holder', holder());",
                "say('queued', frames.length);"));
        assertTrue(envelope(r, "start").has("pending"));
        assertEquals("", r.getString("early"));
        JSONObject v = envelope(r, "result").getJSONObject("v");
        assertTrue("frames=" + v, v.getInt("frames") >= 3 && v.getInt("frames") <= 20);
        assertTrue(v.getInt("ms") >= 100 && v.getInt("ms") < 300);
        assertEquals(Math.round(v.getInt("frames") * 1000.0 / v.getInt("ms")), v.getInt("fps"), 2);
        assertEquals("visible", v.getString("visible"));
        assertEquals("nothing of the probe stays in the page", "undefined", r.getString("holder"));
        assertEquals("and it asks for no more frames once it has its answer", 0, r.getInt("queued"));
    }

    @Test public void withNoFramesTheProbeStaysPendingAndCleanUpCancelsItsFrameRequest() throws Exception {
        // Display off: requestAnimationFrame callbacks do not run.
        JSONObject r = node(String.join("\n",
                "run(" + q(EvalScript.fpsProbe(50, "f1")) + ");",
                "await sleep(120);",
                "say('poll', run(" + q(EvalScript.poll("f1")) + "));",
                "say('queuedBefore', frames.length);",
                "run(" + q(EvalScript.cleanup("f1")) + ");",
                "say('queuedAfter', frames.length);",
                "say('holder', holder());",
                "pump();",
                "say('holderAfterPump', holder());"));
        assertEquals("", r.getString("poll"));
        assertEquals(1, r.getInt("queuedBefore"));
        assertEquals(0, r.getInt("queuedAfter"));
        assertEquals("undefined", r.getString("holder"));
        assertEquals("undefined", r.getString("holderAfterPump"));
    }

    @Test public void twoEvalsAtOnceDoNotDisturbEachOther() throws Exception {
        List<String> lines = new ArrayList<>();
        lines.add("run(" + q(EvalScript.wrap("new Promise((res) => setTimeout(() => res('slow'), 60))", "a1")) + ");");
        lines.add("say('quick', run(" + q(EvalScript.wrap("'quick'", "a2")) + "));");
        lines.add("say('holderMeanwhile', holder());");
        lines.add("await sleep(100);");
        lines.add("say('slow', run(" + q(EvalScript.poll("a1")) + "));");
        lines.add("say('holder', holder());");
        JSONObject r = node(String.join("\n", lines));
        assertEquals("quick", envelope(r, "quick").getString("v"));
        assertEquals("the pending eval's slot is kept", "object", r.getString("holderMeanwhile"));
        assertEquals("slow", envelope(r, "slow").getString("v"));
        assertEquals("undefined", r.getString("holder"));
    }
}
