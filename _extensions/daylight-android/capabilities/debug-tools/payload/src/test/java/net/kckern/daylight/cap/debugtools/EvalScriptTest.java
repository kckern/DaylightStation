package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class EvalScriptTest {
    @Test public void wrapQuotesTheSourceAndHandlesErrorsAndPromises() {
        String js = EvalScript.wrap("document.title + \"x\"", "a1");
        assertTrue(js.contains("\"document.title + \\\"x\\\"\""));
        assertTrue(js.contains("\"a1\""));
        assertTrue(js.contains("(0,eval)("));
        assertTrue(js.contains(".then("));
        assertTrue(js.contains("catch(e)"));
    }

    @Test public void theCallbackValueIsAJsonStringHoldingJson() throws Exception {
        // evaluateJavascript hands back the script's return value JSON-encoded. Our scripts
        // return a string, so the callback value is a JSON string literal whose content is JSON.
        JSONObject r = EvalScript.parse("\"{\\\"v\\\":{\\\"title\\\":\\\"Piano\\\"}}\"");
        assertEquals("Piano", r.getJSONObject("v").getString("title"));
        assertEquals("boom", EvalScript.parse("\"{\\\"e\\\":\\\"boom\\\"}\"").getString("e"));
        assertTrue(EvalScript.parse("\"{\\\"pending\\\":1}\"").has("pending"));
    }

    @Test public void nothingYetParsesAsNull() {
        assertNull(EvalScript.parse(null));
        assertNull(EvalScript.parse("null"));
        assertNull(EvalScript.parse("\"\""));
        assertNull(EvalScript.parse("not json at all {"));
        assertNull(EvalScript.parse("42"));
    }

    @Test public void pollReadsAndClearsOneSlot() {
        String js = EvalScript.poll("a1");
        assertTrue(js.contains("\"a1\""));
        assertTrue(js.contains("delete"));
    }

    @Test public void theFpsProbeCountsAnimationFramesForTheRequestedTimeWithoutReloading() {
        String js = EvalScript.fpsProbe(1000, "a1");
        assertTrue(js.contains("requestAnimationFrame"));
        assertTrue(js.contains("<1000"));
        assertTrue(js.contains("visibilityState"));
        assertFalse(js.contains("location"));
        assertFalse("the probe never navigates or reloads", js.contains("reload"));
    }

    @Test public void idsAreSafeToEmbed() {
        try { EvalScript.wrap("1", "a\";alert(1);\""); fail("expected IllegalArgumentException"); }
        catch (IllegalArgumentException expected) { }
        for (Runnable bad : new Runnable[] { () -> EvalScript.poll("A1"), () -> EvalScript.cleanup(""),
                () -> EvalScript.fpsProbe(1000, null), () -> EvalScript.cleanup("a b") }) {
            try { bad.run(); fail("expected IllegalArgumentException"); } catch (IllegalArgumentException expected) { }
        }
    }

    // ── beyond the plan: the size cap and the clean-up ────────────────────────

    @Test public void aResultOverTheCapIsReplacedInThePageByItsSize() {
        // The cap is applied by the page, so an oversized value never crosses into the app.
        for (String js : new String[] { EvalScript.wrap("1", "a1"), EvalScript.poll("a1") }) {
            assertTrue(js.contains("t.length>" + EvalScript.MAX_RESULT_CHARS));
            assertTrue(js.contains("{big:t.length}"));
        }
        assertEquals(1024 * 1024, EvalScript.MAX_RESULT_CHARS);
        assertTrue(EvalScript.wrap("1", "a1", 8 * 1024 * 1024).contains("t.length>8388608"));
    }

    @Test public void anOversizedResultParsesAsItsSize() throws Exception {
        assertEquals(2_000_000, EvalScript.parse("\"{\\\"big\\\":2000000}\"").getInt("big"));
    }

    @Test public void cleanUpCancelsAPendingFrameAndRemovesWhatWasInjected() {
        String js = EvalScript.cleanup("a1");
        assertTrue(js.contains("\"a1\""));
        assertTrue(js.contains("cancelAnimationFrame"));
        assertTrue("the slot goes", js.contains("delete s[id]"));
        assertTrue("and the holder, once it is empty", js.contains("delete window.__dlEval"));
        // Reading a finished result leaves nothing behind either.
        assertTrue(EvalScript.poll("a1").contains("delete window.__dlEval"));
    }

    @Test public void aPromiseThatSettlesAfterItsSlotWasCleanedUpWritesNothing() {
        // Each settle handler checks that its own slot is still the one in place.
        String js = EvalScript.wrap("fetch('/x')", "a1");
        assertEquals(2, js.split("if\\(s\\[id\\]===slot\\)", -1).length - 1);
        assertTrue(EvalScript.fpsProbe(500, "a1").contains("if(s[id]!==slot)return;"));
    }
}
