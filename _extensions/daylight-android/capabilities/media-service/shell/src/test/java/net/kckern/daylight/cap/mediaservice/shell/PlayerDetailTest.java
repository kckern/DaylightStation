package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The pure parts of Now playing: the smoothed clock, the track detail, the sleep line. */
public class PlayerDetailTest {

    // ── PositionClock ────────────────────────────────────────────────────────

    @Test public void theClockCountsForwardBetweenReports() {
        PositionClock c = new PositionClock();
        c.report(10_000, true, 0);
        assertEquals(10_500, c.at(500));
        c.report(20_000, false, 1000);
        assertEquals(20_000, c.at(5000));
    }

    @Test public void aSmallDisagreementGlidesInsteadOfJumping() {
        PositionClock c = new PositionClock();
        c.report(10_000, true, 0);
        // A screen's poll lands: it says 10.6 s where we show 11 s (400 ms behind us).
        c.report(10_600, true, 1000);
        long right = c.at(1000);
        assertEquals("nothing moves backwards at the report", 11_000, right);
        // The difference is gone after the settle time (max(400, 2 x 400) = 800 ms).
        assertEquals(10_600 + 800, c.at(1800));
        // Halfway, half of it is absorbed.
        assertEquals(10_600 + 400 + 200, c.at(1400));
    }

    @Test public void aSeekOrPauseIsShownAtOnce() {
        PositionClock c = new PositionClock();
        c.report(10_000, true, 0);
        c.report(60_000, true, 1000);
        assertEquals(60_000, c.at(1000));
        c.report(60_500, false, 1500);
        assertEquals(60_500, c.at(1500));
        c.reset();
        c.report(0, true, 2000);
        assertEquals(0, c.at(2000));
    }

    // ── TrackDetail ──────────────────────────────────────────────────────────

    @Test public void samplesAreClampedAndNoneIsEmpty() throws Exception {
        JSONObject reply = new JSONObject("{\"ok\":true,\"levels\":{\"samples\":[0,0.5,1.4,-1]}}");
        assertArrayEquals(new float[] { 0f, 0.5f, 1f, 0f }, TrackDetail.samples(reply), 0.0001f);
        assertEquals(0, TrackDetail.samples(null).length);
        assertEquals(0, TrackDetail.samples(new JSONObject("{\"ok\":true,\"levels\":{\"samples\":[]}}")).length);
    }

    @Test public void qualityReadsLikeAPlayerDoes() throws Exception {
        assertEquals("MP3 · 256 kbps · 44.1 kHz",
                TrackDetail.quality(new JSONObject("{\"levels\":{\"quality\":{\"codec\":\"mp3\",\"bitrate\":256,\"sampleRate\":44100}}}")));
        assertEquals("FLAC · 24-bit · 96 kHz",
                TrackDetail.quality(new JSONObject("{\"levels\":{\"quality\":{\"codec\":\"flac\",\"bitrate\":2800,\"bitDepth\":24,\"sampleRate\":96000}}}")));
        assertEquals("AAC", TrackDetail.quality(new JSONObject("{\"levels\":{\"quality\":{\"codec\":\"aac\"}}}")));
        assertEquals("", TrackDetail.quality(new JSONObject("{\"ok\":true}")));
    }

    @Test public void syncedLyricsFindTheLineBeingSung() throws Exception {
        TrackDetail.Lyrics l = TrackDetail.lyrics(new JSONObject("{\"lyrics\":{\"synced\":true,\"lines\":["
                + "{\"ms\":1000,\"text\":\"one\"},{\"ms\":7690,\"text\":\"two\"},{\"ms\":14710,\"text\":\"\"},{\"ms\":20000,\"text\":\"three\"}]}}"));
        assertTrue(l.synced);
        assertEquals(-1, l.indexAt(0));
        assertEquals(0, l.indexAt(1000));
        assertEquals("a line shows a moment early", 1, l.indexAt(7690 - TrackDetail.Lyrics.LEAD_MS));
        assertEquals(2, l.indexAt(15_000));
        assertEquals(3, l.indexAt(999_999));
    }

    @Test public void plainLyricsHaveNoCurrentLine() throws Exception {
        TrackDetail.Lyrics l = TrackDetail.lyrics(new JSONObject("{\"lyrics\":{\"synced\":false,\"lines\":[{\"ms\":null,\"text\":\"a\"},{\"text\":\"b\"}]}}"));
        assertFalse(l.synced);
        assertEquals(2, l.lines.length);
        assertEquals(-1, l.indexAt(5000));
        assertTrue(TrackDetail.lyrics(null).isEmpty());
    }

    @Test public void aStrayEarlyTimeDoesNotBreakTheSearch() throws Exception {
        TrackDetail.Lyrics l = TrackDetail.lyrics(new JSONObject("{\"lyrics\":{\"synced\":true,\"lines\":["
                + "{\"ms\":5000,\"text\":\"a\"},{\"ms\":3000,\"text\":\"b\"},{\"ms\":9000,\"text\":\"c\"}]}}"));
        assertEquals(1, l.indexAt(6000));
        assertEquals(2, l.indexAt(9000));
    }

    @Test public void theRightHandTimeSwitchesBetweenLeftAndLength() {
        assertEquals("−3:12", TrackDetail.TimeDisplay.REMAINING.right(86_000, 278_000));
        assertEquals("4:38", TrackDetail.TimeDisplay.TOTAL.right(86_000, 278_000));
        assertEquals(TrackDetail.TimeDisplay.TOTAL, TrackDetail.TimeDisplay.REMAINING.next());
        assertEquals(TrackDetail.TimeDisplay.REMAINING, TrackDetail.TimeDisplay.of("junk"));
        assertEquals("", TrackDetail.TimeDisplay.REMAINING.right(0, 0));
    }

    // ── SleepTimer ───────────────────────────────────────────────────────────

    @Test public void theSleepLineRoundsUpToAMinute() {
        assertEquals("Sleep in 1 min", SleepTimer.describe(30_000, 0));
        assertEquals("Sleep in 23 min", SleepTimer.describe(23 * 60_000, 1));
        assertEquals("Sleep at the end of this", SleepTimer.describe(SleepTimer.UNTIL_END_OF_ITEM, 99));
    }
}
