package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;

import org.json.JSONObject;
import org.junit.Test;

public class KeepRowStateTest {
    private static JSONObject in(String state) throws Exception { return new JSONObject().put("state", state); }

    @Test public void theIconSaysTheState() throws Exception {
        assertEquals(KeepRowState.Glyph.KEPT, KeepRowState.glyph(in("ready")));
        assertEquals(KeepRowState.Glyph.MOVING, KeepRowState.glyph(in("downloading")));
        assertEquals(KeepRowState.Glyph.PAUSED, KeepRowState.glyph(in("paused")));
        assertEquals(KeepRowState.Glyph.ERROR, KeepRowState.glyph(in("partly-ready")));
        assertEquals(KeepRowState.Glyph.WAITING, KeepRowState.glyph(in("waiting-wifi")));
    }

    @Test public void theVerbsAreInTheSheetRemoveLast() throws Exception {
        assertEquals(Arrays.asList(KeepRowState.Verb.PAUSE, KeepRowState.Verb.REMOVE), KeepRowState.verbs(in("downloading")));
        assertEquals(Arrays.asList(KeepRowState.Verb.RESUME, KeepRowState.Verb.REMOVE), KeepRowState.verbs(in("paused")));
        assertEquals(Arrays.asList(KeepRowState.Verb.RETRY, KeepRowState.Verb.REMOVE), KeepRowState.verbs(in("partly-ready")));
        assertEquals(Arrays.asList(KeepRowState.Verb.MOBILE_ONCE, KeepRowState.Verb.REMOVE), KeepRowState.verbs(in("waiting-wifi")));
        assertEquals(Collections.singletonList(KeepRowState.Verb.REMOVE), KeepRowState.verbs(in("ready")));
        assertEquals(Collections.emptyList(), KeepRowState.verbs(in("removing")));
    }
}
