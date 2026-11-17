package net.kckern.daylight.cap.widgets;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class WidgetModelTest {
    private static JSONArray actions() throws Exception {
        return new JSONArray("[{\"id\":\"memo\",\"label\":\"New memo\",\"icon\":\"mic\",\"uri\":\"daylight://action/memo#k=K\"},"
                + "{\"id\":\"feed\",\"label\":\"Feed\",\"icon\":\"open\",\"uri\":\"daylight://action/feed#k=K\"},"
                + "{\"id\":\"a3\",\"label\":\"Three\",\"uri\":\"daylight://action/a3\"},{\"id\":\"a4\",\"label\":\"Four\",\"uri\":\"daylight://action/a4\"},"
                + "{\"id\":\"a5\",\"label\":\"Five\",\"uri\":\"daylight://action/a5\"}]");
    }

    @Test public void fillsSlotsInTheListedOrderAndClearsTheRest() throws Exception {
        Map<String, String> cache = WidgetModel.cache(actions(), "feed, memo");
        assertEquals("Feed", cache.get("widget.1.label"));
        assertEquals("open", cache.get("widget.1.icon"));
        assertEquals("daylight://action/feed#k=K", cache.get("widget.1.uri"));
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

    // ── every action, for the one-action button widgets ──────────────────────

    @Test public void everyActionIsWrittenUnderItsIdWithTheListOfIdsInOrder() throws Exception {
        Map<String, String> cache = WidgetModel.actionCache(actions(), "");
        assertEquals("memo,feed,a3,a4,a5", cache.get("action.ids"));
        assertEquals("New memo", cache.get("action.memo.label"));
        assertEquals("mic", cache.get("action.memo.icon"));
        assertEquals("daylight://action/memo#k=K", cache.get("action.memo.uri"));
        assertEquals("", cache.get("action.a3.icon"));
        assertEquals(1 + 5 * 3, cache.size());
    }

    @Test public void anActionThatIsGoneHasItsFieldsClearedSoAButtonBoundToItReadsNotSet() throws Exception {
        Map<String, String> cache = WidgetModel.actionCache(new JSONArray("[{\"id\":\"memo\",\"label\":\"Memo\",\"uri\":\"daylight://action/memo\"}]"),
                "memo,feed, old-one,,../x,Not An Id");
        assertEquals("memo", cache.get("action.ids"));
        assertEquals("", cache.get("action.feed.uri"));
        assertEquals("", cache.get("action.feed.label"));
        assertEquals("", cache.get("action.old-one.uri"));
        assertEquals("Memo", cache.get("action.memo.label"));
        assertFalse("what was never an id makes no key", cache.keySet().toString().contains(".."));
    }

    @Test public void anActionWithoutAnOwnLinkOrAnIdOfTheRightShapeIsLeftOutOfTheButtonList() throws Exception {
        JSONArray odd = new JSONArray("[{\"id\":\"x\",\"label\":\"X\",\"uri\":\"https://evil.example/\"},"
                + "{\"id\":\"Bad Id\",\"label\":\"B\",\"uri\":\"daylight://action/b\"},"
                + "{\"id\":\"ok\",\"label\":\"OK\",\"uri\":\"daylight://action/ok\"},"
                + "{\"id\":\"ok\",\"label\":\"Twice\",\"uri\":\"daylight://action/ok\"}]");
        Map<String, String> cache = WidgetModel.actionCache(odd, "");
        assertEquals("ok", cache.get("action.ids"));
        assertEquals("OK", cache.get("action.ok.label"));
        assertNull(cache.get("action.x.uri"));
    }

    @Test public void theButtonListIsBounded() throws Exception {
        JSONArray many = new JSONArray();
        for (int i = 0; i < 100; i++) many.put(new org.json.JSONObject().put("id", "a" + i).put("label", "L").put("uri", "daylight://action/a" + i));
        assertEquals(WidgetModel.MAX_ACTIONS, WidgetModel.actionCache(many, "").get("action.ids").split(",").length);
    }

    @Test public void theSettingIsCheckedForShapeWhenItIsSet() {
        assertNull(WidgetModel.listProblem(""));
        assertNull(WidgetModel.listProblem("memo, feed"));
        assertTrue(WidgetModel.listProblem("a,b,c,d,e").contains("at most 4"));
        assertTrue(WidgetModel.listProblem("Not An Id").contains("action ids"));
    }
}
