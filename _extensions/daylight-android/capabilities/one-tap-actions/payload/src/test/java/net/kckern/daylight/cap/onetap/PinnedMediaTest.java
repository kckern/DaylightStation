package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.List;

public class PinnedMediaTest {
    @Test public void theIdIsDerivedFromTheContentIdAndIsAnActionId() {
        String id = PinnedMedia.idFor("plex:12345");
        assertTrue(id, id.matches("media-[0-9a-f]{12}"));
        assertTrue(ActionCatalog.ID.matcher(id).matches());
        assertEquals("the same content is the same action", id, PinnedMedia.idFor("plex:12345"));
        assertNotEquals(id, PinnedMedia.idFor("plex:12346"));
        assertFalse("the id does not spell the content", id.contains("12345"));
    }

    /** Full is full: a new pin is refused, and no pin the owner made is pushed out for it. */
    @Test public void atTwentyFourANewPinIsRefusedAndNothingIsEvicted() {
        PinnedMedia p = new PinnedMedia();
        for (int i = 0; i < 24; i++) assertTrue(p.add("plex:" + i, "L" + i, i));
        assertTrue(p.full());
        assertFalse(p.add("plex:new", "New", 100));
        assertEquals(24, p.all().size());
        assertEquals("plex:0", p.all().get(0).contentId);
        assertNull(p.find(PinnedMedia.idFor("plex:new")));
        assertTrue("an existing pin can still be renamed", p.add("plex:3", "Three", 101));
        assertEquals(24, p.all().size());
    }

    /** A shortcut the owner removed from the home screen frees its slot. */
    @Test public void entriesWhoseShortcutIsNoLongerPinnedAreDropped() {
        PinnedMedia p = new PinnedMedia();
        p.add("plex:1", "One", 1);
        p.add("plex:2", "Two", 2);
        java.util.Set<String> stillPinned = new java.util.HashSet<>(java.util.Collections.singletonList(PinnedMedia.idFor("plex:2")));
        List<PinnedMedia.Entry> dropped = p.retainOnly(stillPinned);
        assertEquals(1, dropped.size());
        assertEquals("plex:1", dropped.get(0).contentId);
        assertEquals(1, p.all().size());
        assertTrue(p.retainOnly(stillPinned).isEmpty());
    }

    @Test public void pinningTheSameContentAgainRenamesItAndMakesItTheNewest() {
        PinnedMedia p = new PinnedMedia();
        p.add("plex:1", "One", 1);
        p.add("plex:2", "Two", 2);
        assertTrue(p.add("plex:1", "Uno", 3));
        assertEquals(2, p.all().size());
        assertEquals("plex:2", p.all().get(0).contentId);
        assertEquals("Uno", p.all().get(1).label);
        assertEquals("plex:1", p.find(PinnedMedia.idFor("plex:1")).contentId);
        assertNull(p.find("nope"));
    }

    @Test public void itSurvivesARoundTripAndAFileThatIsNotWhatItWroteLoadsAsEmptyOrWithoutTheBadEntries() {
        PinnedMedia p = new PinnedMedia();
        p.add("plex:1", "One", 1);
        p.add("files:music/a b", "Two", 2);
        PinnedMedia back = PinnedMedia.fromJson(p.toJson());
        assertEquals(2, back.all().size());
        assertEquals("files:music/a b", back.all().get(1).contentId);
        assertEquals("Two", back.all().get(1).label);

        assertEquals(0, PinnedMedia.fromJson("not json").all().size());
        assertEquals(0, PinnedMedia.fromJson(null).all().size());
        PinnedMedia odd = PinnedMedia.fromJson("{\"pins\":[{\"contentId\":\"plex:1\",\"label\":\"One\",\"at\":1},"
                + "{\"contentId\":\"plex:2\"},{\"label\":\"x\"},{\"contentId\":\"plex:3\",\"label\":\"\\u202Eevil\",\"at\":3},"
                + "{\"contentId\":\"plex:4\",\"label\":\"Four\",\"at\":4}]}");
        assertEquals("only whole entries with a plain label load", 2, odd.all().size());
    }

    @Test public void aStoredFileOfMoreThanTheLimitKeepsTheNewest() {
        StringBuilder json = new StringBuilder("{\"pins\":[");
        for (int i = 0; i < 30; i++) json.append(i == 0 ? "" : ",").append("{\"contentId\":\"plex:").append(i).append("\",\"label\":\"L\",\"at\":").append(i).append('}');
        PinnedMedia p = PinnedMedia.fromJson(json.append("]}").toString());
        assertEquals(24, p.all().size());
        assertEquals("plex:6", p.all().get(0).contentId);
    }
}
