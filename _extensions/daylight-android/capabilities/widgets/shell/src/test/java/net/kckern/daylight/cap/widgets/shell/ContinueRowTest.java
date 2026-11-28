package net.kckern.daylight.cap.widgets.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class ContinueRowTest {
    @Test public void aBooksRowSaysItsPartAndWhatIsLeftInTheBook() throws Exception {
        JSONObject row = new JSONObject().put("contentId", "plex:500").put("playContentId", "plex:502")
                .put("title", "Henry VI Part 3").put("subtitle", "William Shakespeare")
                .put("partIndex", 2).put("partCount", 5).put("playhead", 600).put("duration", 1500).put("remainingSec", 5400);
        assertEquals("William Shakespeare · Part 2 of 5 · 1 h 30 min left", ContinueRow.line(row));
        assertTrue(ContinueRow.grouped(row));
    }

    @Test public void aSingleItemSaysOnlyWhatIsLeftAndNeverItsTitleTwice() throws Exception {
        JSONObject row = new JSONObject().put("contentId", "plex:600").put("playContentId", "plex:600")
                .put("title", "Snakes").put("subtitle", "Snakes").put("playhead", 300).put("duration", 3000);
        assertEquals("45 min left", ContinueRow.line(row));
        assertFalse(ContinueRow.grouped(row));
    }

    @Test public void aRowWithNoKnownLengthStatesNoTimeLeft() throws Exception {
        JSONObject row = new JSONObject().put("contentId", "plex:700").put("playContentId", "plex:701")
                .put("title", "A Book").put("subtitle", "An Author").put("partIndex", 1).put("partCount", 2).put("playhead", 100).put("duration", 0);
        assertEquals("An Author · Part 1 of 2", ContinueRow.line(row));
        JSONObject single = new JSONObject().put("contentId", "plex:710").put("playContentId", "plex:710").put("title", "T").put("subtitle", "An Author");
        assertEquals("An Author", ContinueRow.line(single));
    }

    @Test public void theReviewRowCountsTheOlderItems() {
        assertEquals("", ContinueRow.reviewLabel(0));
        assertEquals("Review 1 older item", ContinueRow.reviewLabel(1));
        assertEquals("Review 3 older items", ContinueRow.reviewLabel(3));
    }
}
