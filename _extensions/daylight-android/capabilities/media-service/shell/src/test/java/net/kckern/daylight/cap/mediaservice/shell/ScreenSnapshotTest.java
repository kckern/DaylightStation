package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class ScreenSnapshotTest {
    /** The office screen's session as the backend served it on 2026-11-25 (a shared video), trimmed. */
    private static final String LIVE = "{\"ok\":true,\"status\":200,\"snapshot\":{\"sessionId\":\"98ca314f\",\"state\":\"playing\","
            + "\"currentItem\":{\"contentId\":\"share:s28f795b9c0c1\",\"format\":\"video\",\"title\":\"Me at the zoo\","
            + "\"thumbnail\":\"https://home.example/api/v1/display/share:s28f795b9c0c1\",\"duration\":19},"
            + "\"position\":7.5,\"queue\":{\"items\":[{\"id\":\"share:s28f795b9c0c1\",\"title\":\"Shared video\",\"duration\":null,"
            + "\"contentId\":\"share:s28f795b9c0c1\",\"queueItemId\":\"vJNqi2BKe2\",\"priority\":\"queue\"}],"
            + "\"currentIndex\":0,\"upNextCount\":0},"
            + "\"config\":{\"shuffle\":false,\"repeat\":\"off\",\"shader\":\"default\",\"volume\":100,\"playbackRate\":1},"
            + "\"controls\":{\"notes\":[{\"id\":\"n1\",\"kind\":\"replaced\",\"at\":\"2026-11-26T03:22:32.965Z\",\"label\":\"Replaced by Automation\"},"
            + "{\"id\":\"n2\",\"kind\":\"stopped\",\"at\":\"2026-11-26T02:20:24.019Z\",\"label\":\"Stopped by another device\"}]}}}";

    @Test public void theLiveSnapshotReadsAsOneEntryPlayingWithItsRealTitle() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject(LIVE));
        assertEquals(ScreenSnapshot.Reach.PLAYING_OR_PAUSED, s.reach);
        assertEquals("playing", s.state);
        assertEquals(1, s.entries.size());
        assertEquals(0, s.current);
        ScreenSnapshot.Entry e = s.currentEntry();
        assertEquals("vJNqi2BKe2", e.queueItemId);
        // The queue entry still says "Shared video"; the current item has the fetched title.
        assertEquals("Me at the zoo", e.title);
        assertEquals(19_000, e.durationMs);
        assertEquals(7_500, s.positionMs);
        assertEquals(100, s.volume);
        assertEquals("off", s.repeat);
        assertEquals("Replaced by Automation", s.note);
        assertTrue(s.online());
        assertEquals("a note is history while the screen plays", "", s.statusLine("Office"));
    }

    @Test public void anOffScreenKeepsItsLastItemButIsNotOnline() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":503,\"lastSeenAt\":\"t\","
                + "\"snapshot\":{\"state\":\"paused\",\"currentItem\":{\"contentId\":\"plex:1\",\"title\":\"A film\"},"
                + "\"queue\":{\"items\":[],\"currentIndex\":-1}}}"));
        assertEquals(ScreenSnapshot.Reach.OFF, s.reach);
        assertFalse(s.online());
        assertEquals("A film", s.currentEntry().title);
        assertEquals("Office is off", s.statusLine("Office"));
    }

    @Test public void idleNotOnAndUnreachableEachSayWhatTheyAre() throws Exception {
        assertEquals("Nothing playing on Office", ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":204}")).statusLine("Office"));
        assertEquals("Office is not on", ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":404}")).statusLine("Office"));
        assertEquals("Can't reach home", ScreenSnapshot.parse(new JSONObject("{\"ok\":false,\"error\":\"unreachable\"}")).statusLine("Office"));
        assertEquals("Can't reach home", ScreenSnapshot.parse(null).statusLine("Office"));
    }

    /** The same content twice is two entries, told apart by queueItemId. */
    @Test public void duplicateContentIsTwoEntries() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":200,\"snapshot\":{\"state\":\"paused\","
                + "\"currentItem\":{\"contentId\":\"plex:9\",\"title\":\"Song\"},\"position\":0,"
                + "\"queue\":{\"currentIndex\":1,\"items\":[{\"queueItemId\":\"a\",\"contentId\":\"plex:9\",\"title\":\"Song\"},"
                + "{\"queueItemId\":\"b\",\"contentId\":\"plex:9\",\"title\":\"Song\"},{\"queueItemId\":\"\",\"contentId\":\"plex:3\"}]}}}"));
        assertEquals(2, s.entries.size());
        assertEquals(1, s.current);
        assertEquals("b", s.currentEntry().queueItemId);
    }

    /** A screen playing something outside its queue (a direct load) still shows it. */
    @Test public void aCurrentItemOutsideTheQueueIsShownFirst() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":200,\"snapshot\":{\"state\":\"playing\","
                + "\"currentItem\":{\"contentId\":\"plex:5\",\"title\":\"Brief\"},\"position\":3,"
                + "\"queue\":{\"currentIndex\":-1,\"items\":[{\"queueItemId\":\"q1\",\"contentId\":\"plex:6\",\"title\":\"Next\"}]}}}"));
        assertEquals(2, s.entries.size());
        assertEquals(0, s.current);
        assertEquals("Brief", s.currentEntry().title);
    }

    @Test public void aPausedScreenSaysWhoPausedIt() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":200,\"snapshot\":{\"state\":\"paused\","
                + "\"currentItem\":{\"contentId\":\"plex:1\",\"title\":\"A\"},\"position\":1,"
                + "\"controls\":{\"notes\":[{\"label\":\"Paused by Phone\",\"at\":\"2026-11-26T06:37:00Z\"}]}}}"));
        assertEquals("Paused by Phone", s.statusLine("Office"));
    }
}
