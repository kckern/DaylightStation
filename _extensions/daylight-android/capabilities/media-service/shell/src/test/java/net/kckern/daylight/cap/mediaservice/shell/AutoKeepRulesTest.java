package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Kept automatically while you listen (spec §3.10): the trigger, what is kept, room, removal, words. */
public class AutoKeepRulesTest {
    private static final long MIN = 60_000L, DAY = AutoKeepRules.DAY_MS;

    // ── which items ──────────────────────────────────────────────────────────

    @Test public void aBookOrATalkCountsAndMusicNever() {
        assertTrue("a book part of 40 min", AutoKeepRules.eligible("", 40 * MIN));
        assertTrue("a talk from a list, 15 min", AutoKeepRules.eligible("talks", 15 * MIN));
        assertFalse("a 4-minute song", AutoKeepRules.eligible("", 4 * MIN));
        assertFalse("a song on a household list", AutoKeepRules.eligible("fhe", 4 * MIN));
        assertFalse("a 12-minute track not from a list is not a book", AutoKeepRules.eligible("", 12 * MIN));
        assertFalse("duration not known yet", AutoKeepRules.eligible("talks", 0));
        assertTrue(AutoKeepRules.series("talks"));
        assertFalse(AutoKeepRules.series(""));
    }

    @Test public void listeningIsCountedPerBookOrList() {
        assertEquals("album:the hobbit", AutoKeepRules.itemKey("", " The Hobbit ", "plex:1"));
        assertEquals("album:a course", AutoKeepRules.itemKey("talks", "A Course", "plex:1"));
        assertEquals("list:talks", AutoKeepRules.itemKey("talks", "", "plex:1"));
        assertEquals("item:plex:1", AutoKeepRules.itemKey("", null, "plex:1"));
    }

    @Test public void theThresholdIsMinutesHeard() {
        assertFalse(AutoKeepRules.minutesReached(9 * MIN + 59_000, 10));
        assertTrue(AutoKeepRules.minutesReached(10 * MIN, 10));
        assertTrue("never below a minute", AutoKeepRules.minutesReached(MIN, 0));
    }

    @Test public void minutesAddUpOverSittingsAndOnlyWhilePlaying() {
        Map<String, Long> totals = new HashMap<>();
        ListenMeter.Store store = new ListenMeter.Store() {
            @Override public long heardMs(String key) { return totals.getOrDefault(key, 0L); }
            @Override public void setHeardMs(String key, long ms) { totals.put(key, ms); }
        };
        ListenMeter m = new ListenMeter(store);
        m.play("album:book", 0);
        assertEquals(4 * MIN, m.step(4 * MIN));
        m.pause(6 * MIN);
        assertEquals("paused time is not counted", 6 * MIN, (long) totals.get("album:book"));
        assertEquals(6 * MIN, m.step(60 * MIN));
        // The next day, a new meter (a new process) goes on from the stored total.
        ListenMeter tomorrow = new ListenMeter(store);
        tomorrow.play("album:book", 1_000_000);
        assertEquals(10 * MIN, tomorrow.step(1_000_000 + 4 * MIN));
        // Another item counts on its own.
        tomorrow.play("album:other", 1_000_000 + 4 * MIN);
        assertEquals(MIN, tomorrow.step(1_000_000 + 5 * MIN));
        assertEquals(10 * MIN, (long) totals.get("album:book"));
    }

    @Test public void oneStepNeverAddsMoreThanFiveMinutes() {
        Map<String, Long> totals = new HashMap<>();
        ListenMeter m = new ListenMeter(new ListenMeter.Store() {
            @Override public long heardMs(String key) { return totals.getOrDefault(key, 0L); }
            @Override public void setHeardMs(String key, long ms) { totals.put(key, ms); }
        });
        m.play("k", 0);
        assertEquals(ListenMeter.MAX_STEP_MS, m.step(3 * 60 * MIN));
    }

    // ── what is kept ─────────────────────────────────────────────────────────

    private static final List<String> PARTS = Arrays.asList("p1", "p2", "p3", "p4", "p5");

    @Test public void aBookIsAllItsPartsWithTheCurrentOneFirst() {
        assertEquals(Arrays.asList("p3", "p4", "p5", "p1", "p2"), AutoKeepRules.bookOrder(PARTS, "p3"));
        assertEquals(PARTS, AutoKeepRules.scope(false, PARTS, "p1", false, false));
        assertEquals(Collections.emptyList(), AutoKeepRules.payloadScope(PARTS, AutoKeepRules.bookOrder(PARTS, "p3")));
    }

    @Test public void aSeriesIsTheCurrentLectureAndTheNextTwo() {
        assertEquals(Arrays.asList("p2", "p3", "p4"), AutoKeepRules.scope(true, PARTS, "p2", false, false));
        assertEquals("fewer at the end", Arrays.asList("p4", "p5"), AutoKeepRules.window(PARTS, "p4", 2));
        assertEquals(Collections.singletonList("p9"), AutoKeepRules.window(PARTS, "p9", 2));
        assertEquals(Arrays.asList("p2", "p3", "p4"), AutoKeepRules.payloadScope(PARTS, Arrays.asList("p2", "p3", "p4")));
        // The window moves on: the same three in any order is nothing to do.
        assertTrue(AutoKeepRules.sameParts(Arrays.asList("p4", "p2", "p3"), Arrays.asList("p2", "p3", "p4")));
        assertFalse(AutoKeepRules.sameParts(Arrays.asList("p2", "p3", "p4"), Arrays.asList("p3", "p4", "p5")));
    }

    @Test public void onMobileDataOnlyTheCurrentPartAndOnlyWhenAllowed() {
        assertNull("mobile data not allowed: nothing now", AutoKeepRules.scope(false, PARTS, "p2", true, false));
        assertEquals(Collections.singletonList("p2"), AutoKeepRules.scope(false, PARTS, "p2", true, true));
        assertEquals(Collections.singletonList("p2"), AutoKeepRules.scope(true, PARTS, "p2", true, true));
    }

    // ── room ─────────────────────────────────────────────────────────────────

    @Test public void automaticKeepsHaveAQuarterOfTheLimitAndPushNothingOut() {
        long limit = 4_000_000_000L;
        assertTrue(AutoKeepRules.fits(0, 900_000_000L, 1_000_000_000L, limit));
        assertFalse("over the automatic share", AutoKeepRules.fits(500_000_000L, 600_000_000L, 1_000_000_000L, limit));
        assertFalse("manual keeps fill the limit: nothing is evicted", AutoKeepRules.fits(0, 200_000_000L, 3_900_000_000L, limit));
        assertTrue(AutoKeepRules.fits(0, 1_000_000_000L, 0, limit));
    }

    // ── removal ──────────────────────────────────────────────────────────────

    @Test public void finishedGoesADayLaterAndUnplayedAfterThirtyDays() {
        long g = AutoKeepRules.FINISHED_GRACE_MS, st = AutoKeepRules.STALE_MS, now = 100 * DAY;
        assertNull(AutoKeepRules.removal(true, now - g + MIN, now, now, g, st));
        assertEquals("finished", AutoKeepRules.removal(true, now - g, now, now, g, st));
        assertEquals("stale", AutoKeepRules.removal(true, 0, now - 30 * DAY, now, g, st));
        assertNull(AutoKeepRules.removal(true, 0, now - 29 * DAY, now, g, st));
        assertNull("a manual keep is never removed by these rules", AutoKeepRules.removal(false, now - 9 * DAY, now - 99 * DAY, now, g, st));
        assertEquals("a clock set back makes nothing wait forever",
                null, AutoKeepRules.removal(true, now + 5 * DAY, 0, now, g, st));
        assertEquals(now - g + MIN + g, AutoKeepRules.nextDue(true, now - g + MIN, now, now, g, st));
        assertEquals(0, AutoKeepRules.nextDue(false, now, now, now, g, st));
    }

    @Test public void aPartHeardTo97PercentIsFinished() {
        assertTrue(AutoKeepRules.heardToEnd(970, 1000));
        assertFalse(AutoKeepRules.heardToEnd(960, 1000));
        assertFalse(AutoKeepRules.heardToEnd(10, 0));
    }

    @Test public void onlyADebuggableBuildShortensThePeriods() throws Exception {
        JSONObject debug = new JSONObject().put("graceMin", 2).put("staleMin", 5).put("afterMin", 1);
        AutoKeepRules.Timing release = AutoKeepRules.Timing.from(debug, false);
        assertEquals(AutoKeepRules.FINISHED_GRACE_MS, release.graceMs);
        assertEquals(AutoKeepRules.STALE_MS, release.staleMs);
        assertEquals(10, release.afterMin(10));
        AutoKeepRules.Timing check = AutoKeepRules.Timing.from(debug, true);
        assertEquals(2 * MIN, check.graceMs);
        assertEquals(5 * MIN, check.staleMs);
        assertEquals(1, check.afterMin(10));
        assertEquals(AutoKeepRules.FINISHED_GRACE_MS, AutoKeepRules.Timing.from(new JSONObject(), true).graceMs);
    }

    // ── words ────────────────────────────────────────────────────────────────

    @Test public void theDownloadsNotificationNamesAnAutomaticKeep() {
        assertEquals("Keeping The Hobbit for offline", AutoKeepRules.notificationTitle(1, 0, 14, Collections.singletonList("The Hobbit")));
        assertEquals("Keeping 2 items for offline", AutoKeepRules.notificationTitle(2, 1, 9, Arrays.asList("A", "B")));
        assertEquals("Keeping 2 items · 3 of 26", AutoKeepRules.notificationTitle(2, 3, 26, Collections.singletonList("A")));
        assertEquals("Keeping 1 item", AutoKeepRules.notificationTitle(0, 0, 0, Collections.emptyList()));
    }

    @Test public void removalsAreSaidPlainly() {
        assertEquals("Removed: finished", AutoKeepRules.removedWords("finished"));
        assertEquals("Removed: not played for 30 days", AutoKeepRules.removedWords("stale"));
        assertEquals("Not kept automatically: needs room", AutoKeepRules.NEEDS_ROOM);
    }
}
