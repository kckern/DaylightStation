package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

public class SurfaceKeysTest {
    @Test public void namesTheKeysOfEachSlot() {
        assertEquals("tile.1.label", SurfaceKeys.tile(1, SurfaceKeys.LABEL));
        assertEquals("tile.4.uri", SurfaceKeys.tile(4, SurfaceKeys.URI));
        assertEquals("tile.2.icon", SurfaceKeys.tile(2, SurfaceKeys.ICON));
        assertEquals("widget.3.uri", SurfaceKeys.widget(3, SurfaceKeys.URI));
    }

    @Test public void refusesASlotThatDoesNotExist() {
        for (int bad : new int[] { 0, -1, 5 }) {
            try { SurfaceKeys.tile(bad, SurfaceKeys.URI); fail("accepted tile " + bad); } catch (IllegalArgumentException expected) { }
            try { SurfaceKeys.widget(bad, SurfaceKeys.URI); fail("accepted widget " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void namesTheKeysOfAnActionByItsId() {
        assertEquals("action.journal.label", SurfaceKeys.action("journal", SurfaceKeys.LABEL));
        assertEquals("action.media-0123abcd.uri", SurfaceKeys.action("media-0123abcd", SurfaceKeys.URI));
        assertEquals("action.ids", SurfaceKeys.ACTION_IDS);
    }

    @Test public void anActionIdIsTheShapeEveryActionHasAndNothingElseBecomesAKey() {
        assertTrue(SurfaceKeys.actionId("journal"));
        assertTrue(SurfaceKeys.actionId("a"));
        for (String bad : new String[] { null, "", "Journal", "1st", "a.b", "a b", "a/../b", "-a",
                "a23456789012345678901234567890123" }) {
            assertFalse(String.valueOf(bad), SurfaceKeys.actionId(bad));
            try { SurfaceKeys.action(bad, SurfaceKeys.URI); fail("made a key of " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void onlyADaylightLinkMayBeLaunchedFromTheCache() {
        assertTrue(SurfaceKeys.launchable("daylight://action/memo?k=0123"));
        for (String bad : new String[] { null, "", "https://kiosk.example/", "intent://x#Intent;end", "file:///x",
                "content://x", "javascript:alert(1)", "daylight:x", "DAYLIGHT://action/x", " daylight://action/x" }) {
            assertFalse(String.valueOf(bad), SurfaceKeys.launchable(bad));
        }
    }
}
