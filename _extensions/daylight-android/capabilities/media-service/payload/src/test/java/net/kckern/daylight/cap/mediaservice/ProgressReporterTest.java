package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.mediaservice.ProgressReporter.Report;

import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class ProgressReporterTest {
    private static final long FIVE_MIN = 300_000;
    private final ProgressReporter reporter = new ProgressReporter();

    private List<Report> at(String id, long positionMs, long durationMs, String state, long nowMs) {
        return reporter.onEvent(id, "Title", "", positionMs, durationMs, state, nowMs);
    }

    @Test public void nothingIsReportedInTheFirstTenSeconds() {
        assertTrue(at("plex:1", 0, FIVE_MIN, "playing", 0).isEmpty());
        assertTrue(at("plex:1", 5_000, FIVE_MIN, "playing", 5_000).isEmpty());
        assertTrue(at("plex:1", 10_000, FIVE_MIN, "playing", 10_000).isEmpty());
    }

    @Test public void whilePlayingItReportsAtMostEveryTenSeconds() {
        assertEquals(1, at("plex:1", 11_000, FIVE_MIN, "playing", 11_000).size());
        assertTrue(at("plex:1", 16_000, FIVE_MIN, "playing", 16_000).isEmpty());
        List<Report> next = at("plex:1", 21_000, FIVE_MIN, "playing", 21_000);
        assertEquals(1, next.size());
        assertEquals(21, next.get(0).seconds);
        assertEquals(7.0, next.get(0).percent, 0.001);
        assertFalse(next.get(0).naturalEnd);
    }

    @Test public void aPauseSavesThePositionOnce() {
        at("plex:1", 11_000, FIVE_MIN, "playing", 11_000);
        assertEquals(1, at("plex:1", 14_000, FIVE_MIN, "paused", 14_000).size());
        assertTrue("the same position is not sent twice", at("plex:1", 14_000, FIVE_MIN, "stopped", 15_000).isEmpty());
    }

    @Test public void aSkimIsNotSavedButANearlyFinishedShortItemIs() {
        assertTrue(at("plex:1", 5_000, FIVE_MIN, "paused", 5_000).isEmpty());
        assertEquals(1, at("plex:2", 9_000, 9_500, "paused", 20_000).size());
    }

    @Test public void theEndIsReportedOnceAsANaturalEnd() {
        at("plex:1", 11_000, FIVE_MIN, "playing", 11_000);
        List<Report> end = at("plex:1", FIVE_MIN, FIVE_MIN, "ended", 301_000);
        assertEquals(1, end.size());
        assertTrue(end.get(0).naturalEnd);
        assertEquals(300, end.get(0).seconds);
        assertEquals(100.0, end.get(0).percent, 0.001);
        assertTrue(at("plex:1", FIVE_MIN, FIVE_MIN, "ended", 301_500).isEmpty());
        assertTrue("nothing more is saved for an item that ended", at("plex:1", FIVE_MIN, FIVE_MIN, "paused", 302_000).isEmpty());
    }

    @Test public void movingToAnotherItemSavesTheOneThatWasLeft() {
        at("plex:1", 11_000, FIVE_MIN, "playing", 11_000);
        at("plex:1", 18_000, FIVE_MIN, "playing", 18_000);
        List<Report> change = at("plex:2", 0, FIVE_MIN, "playing", 19_000);
        assertEquals(1, change.size());
        assertEquals("plex:1", change.get(0).contentId);
        assertEquals(18, change.get(0).seconds);
        assertEquals("the new item starts its own ten-second count", 1, at("plex:2", 11_000, FIVE_MIN, "playing", 30_000).size());
    }

    @Test public void withNoKnownDurationNothingIsReported() {
        assertTrue(at("plex:1", 60_000, 0, "playing", 60_000).isEmpty());
        assertTrue(at("plex:1", 60_000, 0, "paused", 61_000).isEmpty());
    }

    @Test public void anEventThatIsNotAboutAHouseholdItemIsDropped() {
        assertTrue(at("https://evil.example/a.mp3", 60_000, FIVE_MIN, "playing", 60_000).isEmpty());
        assertTrue(at(null, 60_000, FIVE_MIN, "playing", 60_000).isEmpty());
        assertTrue(at("plex:1", 60_000, FIVE_MIN, "exploding", 60_000).isEmpty());
    }

    @Test public void aClockThatJumpsBackDoesNotStopTheReports() {
        assertEquals(1, at("plex:1", 30_000, FIVE_MIN, "playing", 1_000_000).size());
        assertEquals(1, at("plex:1", 45_000, FIVE_MIN, "playing", 5_000).size());
    }

    @Test public void aReportBecomesThePlayLogBody() throws Exception {
        List<Report> reports = reporter.onEvent("plex:1", "So What", "list-9", 30_000, FIVE_MIN, "playing", 30_000);
        JSONObject body = reports.get(0).toBody();
        assertEquals("plex", body.getString("type"));
        assertEquals("plex:1", body.getString("assetId"));
        assertEquals(30, body.getInt("seconds"));
        assertEquals(10.0, body.getDouble("percent"), 0.001);
        assertEquals("So What", body.getString("title"));
        assertEquals("list-9", body.getString("listId"));
        assertEquals("exactly the web player's fields", 6, body.length());
        // The web player's last report is the same body at the end position: it sends no
        // naturalEnd and no status, and a missing list as null.
        JSONObject end = reporter.onEvent("plex:1", "So What", "", FIVE_MIN, FIVE_MIN, "ended", 400_000).get(0).toBody();
        assertEquals(100.0, end.getDouble("percent"), 0.001);
        assertEquals(300, end.getInt("seconds"));
        assertTrue(end.has("listId") && end.isNull("listId"));
        assertFalse(end.has("naturalEnd"));
        assertFalse(end.has("status"));
        assertEquals("the type is the content's source, which picks the backend's adapter", "files",
                reporter.onEvent("files:clips/a.mp3", "A", "", 30_000, FIVE_MIN, "playing", 500_000).get(0).toBody().getString("type"));
    }
}
