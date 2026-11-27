package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class BookLeftTest {
    /** Henry VI Part 3 on the real phone: parts never played counted as nothing left in them. */
    @Test public void partsWithNoPlaceStillCountAsToCome() throws Exception {
        List<String> ids = Arrays.asList("p1", "p2", "p3", "p4");
        Map<String, Long> len = new HashMap<>();
        for (String id : ids) len.put(id, 1800L);
        JSONObject progress = new JSONObject()
                .put("p1", new JSONObject().put("playhead", 1800).put("duration", 1800).put("finished", true))
                .put("p2", new JSONObject().put("playhead", 600).put("duration", 1800));
        BookLeft b = BookLeft.of(ids, len, progress);
        assertEquals(1200 + 1800 + 1800, b.leftSec);      // the rest of p2, then p3 and p4 whole
        assertEquals(7200, b.totalSec);
        assertEquals(33, b.percent);
        assertTrue(b.started);
        assertFalse(b.finished);
    }

    @Test public void notStartedAndFinished() throws Exception {
        List<String> ids = Arrays.asList("p1");
        assertFalse(BookLeft.of(ids, null, new JSONObject()).started);
        assertTrue(BookLeft.of(ids, null, new JSONObject().put("p1", new JSONObject().put("playhead", 990).put("duration", 1000))).finished);
    }

    /** The row's length wins over the place's recorded one, as the author's row counts (they differed by a minute). */
    @Test public void thePartsOwnLengthIsTheOneCounted() throws Exception {
        Map<String, Long> len = new HashMap<>();
        len.put("p1", 1800L);
        JSONObject progress = new JSONObject().put("p1", new JSONObject().put("playhead", 600).put("duration", 1870));
        assertEquals(1200, BookLeft.of(Arrays.asList("p1"), len, progress).leftSec);
        assertEquals(1270, BookLeft.of(Arrays.asList("p1"), null, progress).leftSec);
    }
}
