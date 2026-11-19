package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class SearchAnswerTest {
    private PayloadPort.Handler handler;

    @After public void tearDown() {
        if (handler != null) PayloadPort.named(PayloadMedia.PORT).detach(handler);
    }

    @Test public void theRequestCarriesTheQueryAndNothingElse() throws Exception {
        final String[] seen = new String[1];
        handler = request -> { seen[0] = request; return "{\"ok\":true,\"items\":[]}"; };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        new PayloadMedia().search("so what", 0);
        JSONObject r = new JSONObject(seen[0]);
        assertEquals("search", r.getString("op"));
        assertEquals("so what", r.getString("query"));
        assertEquals(2, r.length());
    }

    @Test public void theBestToPlayIsAnItemIdOrNothing() {
        assertEquals("p:plex:1", SearchAnswer.best("{\"ok\":true,\"items\":[],\"best\":\"p:plex:1\"}"));
        for (String bad : new String[] { null, "x", "{\"ok\":false,\"best\":\"p:plex:1\"}", "{\"ok\":true}",
                "{\"ok\":true,\"best\":\"c:plex:1\"}", "{\"ok\":true,\"best\":\"https://kiosk.example/a\"}" }) {
            assertNull(String.valueOf(bad), SearchAnswer.best(bad));
        }
    }

    /** Play-from-search reaches onSetMediaItems in Media3 1.1.1 as one item with no media id and a search query. */
    @Test public void aPlayFromSearchRequestIsOneItemWithNoIdAndAQuery() {
        assertEquals("so what", SearchAnswer.playFromSearch(Collections.singletonList(""), Collections.singletonList("so what")));
        assertEquals("an empty query is a request too (\"play music\")", "",
                SearchAnswer.playFromSearch(Collections.singletonList(""), Collections.singletonList("")));
        assertNull("an item with an id is an ordinary request",
                SearchAnswer.playFromSearch(Collections.singletonList("p:plex:1"), Collections.singletonList("so what")));
        assertNull("no query: not a search", SearchAnswer.playFromSearch(Collections.singletonList(""), Collections.<String>singletonList(null)));
        List<String> two = Arrays.asList("", "");
        assertNull(SearchAnswer.playFromSearch(two, two));
    }

    @Test public void aPageOfResultsIsASliceAndAPageBeyondTheEndIsEmpty() {
        List<Integer> all = Arrays.asList(0, 1, 2, 3, 4, 5, 6);
        assertEquals(Arrays.asList(3, 4, 5), SearchAnswer.page(all, 1, 3));
        assertEquals(Collections.singletonList(6), SearchAnswer.page(all, 2, 3));
        assertTrue(SearchAnswer.page(all, 3, 3).isEmpty());
        assertTrue(SearchAnswer.page(all, -1, 3).isEmpty());
        assertEquals(all, SearchAnswer.page(all, 0, 0));
        assertEquals("a huge page is no page at all", all, SearchAnswer.page(all, 0, Integer.MAX_VALUE));
    }
}
