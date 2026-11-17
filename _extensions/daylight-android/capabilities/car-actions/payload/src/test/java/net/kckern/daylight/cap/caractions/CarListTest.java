package net.kckern.daylight.cap.caractions;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class CarListTest {
    private final Map<String, JSONObject> actions = new HashMap<>();
    private final CarList.Lookup lookup = actions::get;

    private void action(String id, String label, String kind, String target) throws Exception {
        actions.put(id, new JSONObject().put("id", id).put("label", label).put("icon", "bolt").put("kind", kind).put("target", target));
    }

    private List<CarList.Entry> usable(String value, List<String> problems) {
        return CarList.usable(value, lookup, problems);
    }

    @Test public void keepsHouseholdCallsAndThePlaceholderInOrder() throws Exception {
        action("lights", "Lights off", "api", "/api/v1/home/scenes/all-off");
        action("omw", "On my way", "location", "share");
        List<String> problems = new ArrayList<>();
        List<CarList.Entry> list = usable(" omw , lights ", problems);
        assertTrue(problems.toString(), problems.isEmpty());
        assertEquals(2, list.size());
        assertEquals("omw", list.get(0).id);
        assertEquals("On my way", list.get(0).label);
        assertEquals(CarList.RUN, list.get(0).kind);
        assertEquals("lights", list.get(1).id);
        assertTrue("empty is an empty list", usable("", problems).isEmpty());
    }

    @Test public void aWebPageAMediaItemOrAScreenOfThePhoneIsLeftOutAndNamed() throws Exception {
        action("media", "Media", "bookmark", "media");
        action("feed", "Feed", "open", "/feed");
        action("radio", "Radio", "media", "plex:1");
        action("note", "Journal note", "input", "text:journal-note");
        action("photo", "Meal photo", "input", "photo:meal-photo");
        action("omw", "On my way", "location", "share");
        List<String> problems = new ArrayList<>();
        List<CarList.Entry> list = usable("media,feed,radio,note,photo,omw", problems);
        assertEquals(1, list.size());
        assertEquals("omw", list.get(0).id);
        assertEquals(5, problems.size());
        assertTrue(problems.get(0), problems.get(0).contains("action 'media' cannot be used in a car"));
        assertTrue(problems.get(0), problems.get(0).contains("a web page"));
        assertTrue(problems.get(2), problems.get(2).contains("media app"));
        assertTrue(problems.get(3), problems.get(3).contains("keyboard"));
        assertTrue(problems.get(4), problems.get(4).contains("camera"));
    }

    @Test public void anUnknownIdABadIdAndADuplicateAreProblemsNotExceptions() throws Exception {
        action("omw", "On my way", "location", "share");
        List<String> problems = new ArrayList<>();
        List<CarList.Entry> list = usable("nothing,Not An Id,omw,omw", problems);
        assertEquals(1, list.size());
        assertEquals(3, problems.size());
        assertTrue(problems.get(0), problems.get(0).contains("no action 'nothing'"));
        assertTrue(problems.get(1), problems.get(1).contains("not an action id"));
        assertTrue(problems.get(2), problems.get(2).contains("twice"));
    }

    @Test public void atMostSixAreShown() throws Exception {
        StringBuilder value = new StringBuilder();
        for (int i = 1; i <= 8; i++) {
            action("a" + i, "A" + i, "api", "/api/v1/x" + i);
            value.append(i == 1 ? "" : ",").append("a").append(i);
        }
        List<String> problems = new ArrayList<>();
        assertEquals(CarList.MAX, usable(value.toString(), problems).size());
        assertEquals(1, problems.size());
        assertTrue(problems.get(0).contains("at most 6"));
    }

    /** Written by hand: a setting that names a web page is refused, and so is a malformed one. */
    @Test public void theSettingRefusesWhatTheCarCannotShowWhenItKnowsTheAction() throws Exception {
        action("media", "Media", "bookmark", "media");
        action("omw", "On my way", "location", "share");
        assertNull(CarList.settingProblem("omw", lookup));
        assertNull(CarList.settingProblem("", lookup));
        assertNull("an id that is not an action yet is left to the status", CarList.settingProblem("later", lookup));
        assertNotNull(CarList.settingProblem("media", lookup));
        assertNotNull(CarList.settingProblem("omw,Bad Id", lookup));
        assertNotNull(CarList.settingProblem("a,b,c,d,e,f,g", lookup));
        assertNull("without the action list the shape is all that is checked", CarList.settingProblem("media", null));
    }

    @Test public void aProblemNeverRepeatsATarget() throws Exception {
        action("secret", "Secret", "open", "/private/page");
        List<String> problems = new ArrayList<>();
        usable("secret", problems);
        assertFalse(problems.get(0).contains("/private/page"));
    }
}
