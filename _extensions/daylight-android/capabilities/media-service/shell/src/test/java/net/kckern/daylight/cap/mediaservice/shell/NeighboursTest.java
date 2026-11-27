package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.List;

import org.json.JSONObject;
import org.junit.Test;

public class NeighboursTest {
    private static JSONObject r(String id, String title) throws Exception {
        return new JSONObject().put("id", id).put("title", title).put("browsable", true);
    }

    @Test public void theListItCameFromInItsOrder() throws Exception {
        List<JSONObject> rows = Arrays.asList(r("c:plex:1", "Boethius"), r("c:plex:2", "Dante"), r("c:plex:3", "Thomas More"),
                new JSONObject().put("id", "m:50|plex:x").put("title", "More"));
        Neighbours n = Neighbours.fromRows(rows, "c:plex:2", "author");
        assertTrue(n.pages());
        assertEquals(3, n.entries.size());   // the More row is not a page
        assertEquals("‹ Boethius · Thomas More ›", n.line());
        assertTrue(n.move(1));
        assertEquals("Thomas More", n.current().title);
        assertNull(n.at(1));
        assertFalse(n.move(1));              // the edge: nothing changes
        assertEquals("‹ Dante", n.line());
        Neighbours back = Neighbours.parse(n.toJson(), n.index);
        assertEquals("c:plex:3", back.current().id);
    }

    @Test public void noListNoPaging() throws Exception {
        assertFalse(Neighbours.parse(null, -1).pages());
        assertFalse(Neighbours.fromRows(Arrays.asList(r("c:plex:1", "Only")), "c:plex:1", "book").pages());
        assertFalse(Neighbours.fromRows(Arrays.asList(r("c:plex:1", "A")), "c:plex:9", "book").pages());
        assertEquals("", Neighbours.NONE.line());
    }
}
