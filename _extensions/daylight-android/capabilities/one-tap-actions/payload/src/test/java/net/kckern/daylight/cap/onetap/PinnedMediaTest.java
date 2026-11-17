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

    @Test public void atMostTwentyFourAreKeptAndTheOldestGoesFirst() {
        PinnedMedia p = new PinnedMedia();
        for (int i = 0; i < 24; i++) assertTrue(p.add("plex:" + i, "L" + i, i).isEmpty());
        List<PinnedMedia.Entry> evicted = p.add("plex:new", "New", 100);
        assertEquals(1, evicted.size());
        assertEquals("plex:0", evicted.get(0).contentId);
        assertEquals(24, p.all().size());
        assertEquals("plex:1", p.all().get(0).contentId);
        assertEquals("plex:new", p.all().get(23).contentId);
    }

    @Test public void pinningTheSameContentAgainRenamesItAndMakesItTheNewest() {
        PinnedMedia p = new PinnedMedia();
        p.add("plex:1", "One", 1);
        p.add("plex:2", "Two", 2);
        assertTrue(p.add("plex:1", "Uno", 3).isEmpty());
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
