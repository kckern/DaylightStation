package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ContinueHidesTest {
    @Rule public TemporaryFolder dir = new TemporaryFolder();

    @Test public void aHideHoldsUntilHomeHearsIt() throws Exception {
        ContinueHides h = new ContinueHides(dir.newFile("h.json"));
        h.hide("plex:1", 10);
        JSONArray items = new JSONArray().put(new JSONObject().put("contentId", "plex:1")).put(new JSONObject().put("contentId", "plex:2"));
        assertEquals(1, h.filter(items).length());
        assertEquals("hide", h.waiting().get(0).getString("op"));
        // Home took it: its own answer leaves the item out from now on (and brings it back when played again).
        h.sent("plex:1", "hide");
        assertTrue(h.waiting().isEmpty());
        assertEquals(2, h.filter(items).length());
        // It survives a restart while waiting.
        h.hide("plex:2", 20);
        assertTrue(new ContinueHides(dir.getRoot().toPath().resolve("h.json").toFile()).hiddenHere("plex:2"));
    }

    @Test public void undoBeforeHomeHeardForgetsIt() throws Exception {
        ContinueHides h = new ContinueHides(dir.newFile("h.json"));
        h.hide("plex:1", 10);
        h.unhide("plex:1", 11);
        assertTrue(h.waiting().isEmpty());
        // After home heard it, Undo is a request of its own.
        h.hide("plex:1", 12);
        h.sent("plex:1", "hide");
        h.unhide("plex:1", 13);
        assertEquals("unhide", h.waiting().get(0).getString("op"));
        assertFalse(h.hiddenHere("plex:1"));
    }

    @Test public void notAContentIdIsIgnored() throws Exception {
        ContinueHides h = new ContinueHides(dir.newFile("h.json"));
        h.hide("../x", 1);
        assertTrue(h.waiting().isEmpty());
    }
}
