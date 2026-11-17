package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class OverlayRequestTest {
    private static OverlayRequest parse(String json) throws Exception { return OverlayRequest.parse(new JSONObject(json)); }

    @Test public void textSetsOnlyTheTextLayer() throws Exception {
        OverlayRequest r = parse("{\"text\":\"Five minutes left\"}");
        assertTrue(r.setsText);
        assertEquals("Five minutes left", r.text);
        assertFalse("the web overlay is left as it is", r.setsWeb);
    }

    @Test public void emptyTextClearsOnlyTheText() throws Exception {
        OverlayRequest r = parse("{\"text\":\"\"}");
        assertTrue(r.setsText);
        assertEquals("", r.text);
        assertFalse(r.setsWeb);
    }

    @Test public void aUrlSetsOnlyTheWebLayerWithAnOptionalGravity() throws Exception {
        OverlayRequest r = parse("{\"url\":\"https://kiosk.example/overlay?d=shield\",\"gravity\":\"bottom\"}");
        assertTrue(r.setsWeb);
        assertEquals("https://kiosk.example/overlay?d=shield", r.url);
        assertEquals("bottom", r.gravity);
        assertFalse("an operator's message is left as it is", r.setsText);
        assertNull(parse("{\"url\":\"https://kiosk.example/overlay\"}").gravity);
    }

    @Test public void anEmptyUrlClearsOnlyTheWebLayer() throws Exception {
        OverlayRequest r = parse("{\"url\":\"\"}");
        assertTrue(r.setsWeb);
        assertEquals("", r.url);
        assertFalse(r.setsText);
    }

    @Test public void anEmptyBodyClearsBothLayers() throws Exception {
        OverlayRequest r = parse("{}");
        assertTrue(r.setsText);
        assertTrue(r.setsWeb);
        assertEquals("", r.text);
        assertEquals("", r.url);
    }

    @Test public void textAndUrlTogetherSetBoth() throws Exception {
        OverlayRequest r = parse("{\"text\":\"hello\",\"url\":\"https://kiosk.example/o\"}");
        assertEquals("hello", r.text);
        assertEquals("https://kiosk.example/o", r.url);
    }

    @Test public void refusesWhatItCannotShow() throws Exception {
        for (String bad : new String[] {
                "{\"text\":5}", "{\"url\":5}", "{\"url\":\"file:///sdcard/x.html\"}", "{\"url\":\"javascript:alert(1)\"}",
                "{\"url\":\"https://kiosk.example/o\",\"gravity\":\"left\"}", "{\"url\":\"https://kiosk.example/o\",\"gravity\":1}" }) {
            try { parse(bad); fail("expected a bad request for " + bad); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void theAnswerReportsEachLayerAndASummary() throws Exception {
        JSONObject both = OverlayRequest.answer(true, true, true, false, "https://kiosk.example/o", null);
        assertTrue(both.getBoolean("ok"));
        assertTrue(both.getBoolean("shown"));
        assertEquals("the web overlay is what an arcade caller asks about", "web", both.getString("kind"));
        assertTrue(both.getJSONObject("text").getBoolean("shown"));
        assertTrue(both.getJSONObject("web").getBoolean("shown"));
        assertEquals("https://kiosk.example/o", both.getJSONObject("web").getString("url"));

        JSONObject text = OverlayRequest.answer(true, false, false, false, "", null);
        assertEquals("text", text.getString("kind"));
        assertTrue(text.getJSONObject("web").isNull("url"));

        JSONObject none = OverlayRequest.answer(false, false, false, false, "", null);
        assertTrue(none.getBoolean("ok"));
        assertFalse(none.getBoolean("shown"));
        assertEquals("none", none.getString("kind"));
    }

    @Test public void aLayerThatWasAskedForAndIsNotShowingIsNotOk() throws Exception {
        JSONObject r = OverlayRequest.answer(false, false, false, false, "", "overlay_not_shown");
        assertFalse(r.getBoolean("ok"));
        assertEquals("overlay_not_shown", r.getString("error"));
        assertFalse(r.getJSONObject("web").getBoolean("shown"));
    }
}
