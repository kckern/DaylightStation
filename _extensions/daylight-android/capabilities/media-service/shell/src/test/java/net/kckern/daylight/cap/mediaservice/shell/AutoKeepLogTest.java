package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;

/** On this phone's list of automatic keeps not on the phone: needs room, and removals for 7 days. */
public class AutoKeepLogTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private static final long DAY = AutoKeepRules.DAY_MS;

    @Test public void removalsAreListedSevenDaysNewestFirst() throws Exception {
        AutoKeepLog log = new AutoKeepLog(tmp.newFolder("files"));
        log.removed("plex:1", "Book one", "finished", 10 * DAY);
        log.removed("plex:2", "Book two", "stale", 12 * DAY);
        List<JSONObject> shown = log.shown(13 * DAY);
        assertEquals(2, shown.size());
        assertEquals("plex:2", shown.get(0).getString("contentId"));
        assertEquals("Removed: not played for 30 days", AutoKeepLog.words(shown.get(0)));
        assertEquals("Removed: finished", log.lineFor("plex:1", 13 * DAY));
        assertEquals("gone after 7 days", 1, log.shown(17 * DAY + 1).size());
    }

    @Test public void aSkipSaysNeedsRoomUntilItIsKept() throws Exception {
        AutoKeepLog log = new AutoKeepLog(tmp.newFolder("files"));
        log.skipped("plex:3", "Course", 1);
        log.skipped("plex:3", "Course", 2);
        assertEquals("one line per item", 1, log.shown(3).size());
        assertEquals("Not kept automatically: needs room", log.lineFor("plex:3", 3));
        log.clear("plex:3");
        assertEquals("", log.lineFor("plex:3", 3));
    }
}
