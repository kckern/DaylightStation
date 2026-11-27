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

    /** A search group that mixes kinds: an author's neighbours are people only (2026-11-27). */
    @Test public void fromASearchOnlyTheSameFamily() throws Exception {
        List<JSONObject> group = Arrays.asList(
                r("c:plex:10", "Shakespeare: The Biography").put("kind", "book"),
                r("c:plex:727362", "William Shakespeare").put("kind", "author"),
                r("c:plex:11", "Nicholas Shakespeare").put("kind", "author"),
                r("c:plex:12", "Shakespeare's Sister").put("kind", "artist"),
                r("c:plex:13", "Shakespeare Sonnets").put("kind", "album"));
        Neighbours n = Neighbours.fromRows(group, "c:plex:727362", "author");
        assertEquals(3, n.entries.size());
        assertNull(n.at(-1));
        assertEquals("Nicholas Shakespeare", n.at(1).title);
        for (Neighbours.Entry e : n.entries) assertEquals("people", Neighbours.family(e.kind));
        Neighbours book = Neighbours.fromRows(group, "c:plex:10", "author");
        assertFalse(book.pages());   // the only book in the group
    }
}
