package net.kckern.daylight.cap.widgets;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class WidgetModelTest {
    private static JSONArray actions() throws Exception {
        return new JSONArray("[{\"id\":\"memo\",\"label\":\"New memo\",\"icon\":\"mic\",\"uri\":\"daylight://action/memo?k=K\"},"
                + "{\"id\":\"feed\",\"label\":\"Feed\",\"icon\":\"open\",\"uri\":\"daylight://action/feed?k=K\"},"
                + "{\"id\":\"a3\",\"label\":\"Three\",\"uri\":\"daylight://action/a3\"},{\"id\":\"a4\",\"label\":\"Four\",\"uri\":\"daylight://action/a4\"},"
                + "{\"id\":\"a5\",\"label\":\"Five\",\"uri\":\"daylight://action/a5\"}]");
    }

    @Test public void fillsSlotsInTheListedOrderAndClearsTheRest() throws Exception {
        Map<String, String> cache = WidgetModel.cache(actions(), "feed, memo");
        assertEquals("Feed", cache.get("widget.1.label"));
        assertEquals("open", cache.get("widget.1.icon"));
        assertEquals("daylight://action/feed?k=K", cache.get("widget.1.uri"));
        assertEquals("New memo", cache.get("widget.2.label"));
        assertEquals("", cache.get("widget.3.uri"));
        assertEquals("", cache.get("widget.4.label"));
        assertEquals(12, cache.size());
    }

    @Test public void withNoListItTakesTheFirstFour() throws Exception {
        Map<String, String> cache = WidgetModel.cache(actions(), "");
        assertEquals("New memo", cache.get("widget.1.label"));
        assertEquals("Four", cache.get("widget.4.label"));
    }

    @Test public void namesAnUnknownActionOrTooMany() throws Exception {
        try { WidgetModel.cache(actions(), "memo,nope"); fail(); }
        catch (IllegalArgumentException e) { assertTrue(e.getMessage().contains("widgets.actions names unknown action 'nope'")); }
        try { WidgetModel.cache(actions(), "memo,feed,a3,a4,a5"); fail(); }
        catch (IllegalArgumentException e) { assertTrue(e.getMessage().contains("widgets.actions has 5 entries; the widget has 4 slots")); }
    }

    @Test public void noActionsAtAllIsAnEmptyWidget() throws Exception {
        assertEquals("", WidgetModel.cache(new JSONArray(), "").get("widget.1.uri"));
    }

    @Test public void theLenientModelLeavesOutWhatItCannotPlaceAndReportsIt() throws Exception {
        List<String> problems = new ArrayList<>();
        Map<String, String> cache = WidgetModel.usable(actions(), "nope,feed,a3,a4,a5,memo", problems);
        assertEquals("Feed", cache.get("widget.1.label"));
        assertEquals("Five", cache.get("widget.4.label"));
        assertEquals(12, cache.size());
        assertEquals(2, problems.size());
    }

    @Test public void aLinkThatIsNotTheAppsOwnSchemeNeverReachesTheCache() throws Exception {
        JSONArray odd = new JSONArray("[{\"id\":\"x\",\"label\":\"X\",\"uri\":\"https://evil.example/\"}]");
        List<String> problems = new ArrayList<>();
        assertEquals("", WidgetModel.usable(odd, "", problems).get("widget.1.uri"));
        assertEquals(1, problems.size());
    }

    @Test public void theSettingIsCheckedForShapeWhenItIsSet() {
        assertNull(WidgetModel.listProblem(""));
        assertNull(WidgetModel.listProblem("memo, feed"));
        assertTrue(WidgetModel.listProblem("a,b,c,d,e").contains("at most 4"));
        assertTrue(WidgetModel.listProblem("Not An Id").contains("action ids"));
    }
}
