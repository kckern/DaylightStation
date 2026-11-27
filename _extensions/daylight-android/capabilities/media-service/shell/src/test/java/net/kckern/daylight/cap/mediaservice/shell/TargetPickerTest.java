package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

/** The one Play on picker: what each screen's row says, and whether it can be picked. */
public class TargetPickerTest {
    private static ScreenSnapshot snap(int status, String body) throws Exception {
        JSONObject reply = new JSONObject().put("ok", true).put("status", status);
        if (body != null) reply.put("snapshot", new JSONObject(body));
        return ScreenSnapshot.parse(reply);
    }

    @Test public void eachStateHasItsLine() throws Exception {
        assertEquals("Off", TargetPicker.stateLine(snap(503, null)));
        assertEquals("Off", TargetPicker.stateLine(snap(404, null)));
        assertEquals("Nothing playing", TargetPicker.stateLine(snap(204, null)));
        String playing = "{\"state\":\"playing\",\"currentItem\":{\"title\":\"Moyda\",\"queueItemId\":\"q1\",\"contentId\":\"plex:1\"},"
                + "\"queue\":{\"items\":[{\"queueItemId\":\"q1\",\"contentId\":\"plex:1\",\"title\":\"Moyda\"}],\"currentIndex\":0}}";
        assertEquals("Moyda", TargetPicker.stateLine(snap(200, playing)));
        assertEquals("Moyda · paused", TargetPicker.stateLine(snap(200, playing.replace("\"playing\"", "\"paused\""))));
        assertEquals("Can't check", TargetPicker.stateLine(ScreenSnapshot.unreachable()));
    }

    @Test public void anOffScreenCannotBePickedUnlessItIsInUse() throws Exception {
        assertFalse(TargetPicker.pickable(snap(503, null), false));
        assertFalse(TargetPicker.pickable(snap(404, null), false));
        assertTrue(TargetPicker.pickable(snap(503, null), true));
        assertTrue(TargetPicker.pickable(snap(204, null), false));
        assertTrue(TargetPicker.pickable(ScreenSnapshot.unreachable(), false));
    }
}
