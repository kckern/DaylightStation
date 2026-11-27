package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class CrossfadeTest {
    private static Crossfade.Side song(long ms, String album, String artist) {
        return new Crossfade.Side(false, ms, album, artist);
    }

    private static final Crossfade.Side A1 = song(200_000, "Blue", "Joni Mitchell");
    private static final Crossfade.Side A2 = song(180_000, "Blue", "Joni Mitchell");
    private static final Crossfade.Side B1 = song(240_000, "Kind of Blue", "Miles Davis");

    @Test public void betweenRecordsItFadesFromTheEnd() {
        Crossfade.Plan p = Crossfade.plan(4, A1, B1, false, false, false, 10_000);
        assertTrue(p.fades());
        assertEquals(4_000, p.fadeMs);
        assertEquals(196_000, p.startMs);
    }

    @Test public void aRecordPlayedInOrderNeverFades() {
        assertEquals(Crossfade.Skip.IN_ORDER_ALBUM, Crossfade.plan(4, A1, A2, false, false, false, 0).skip);
    }

    @Test public void theSameRecordShuffledFades() {
        assertTrue(Crossfade.plan(4, A1, A2, true, false, false, 0).fades());
    }

    @Test public void unknownAlbumsAreNotTheSameRecord() {
        assertTrue(Crossfade.plan(4, song(200_000, "", ""), song(200_000, "", ""), false, false, false, 0).fades());
    }

    @Test public void longFormNeverFadesOnEitherSide() {
        Crossfade.Side book = new Crossfade.Side(true, 3_600_000, "Book", "Author");
        assertEquals(Crossfade.Skip.LONG_FORM, Crossfade.plan(4, book, B1, false, false, false, 0).skip);
        assertEquals(Crossfade.Skip.LONG_FORM, Crossfade.plan(4, A1, book, false, false, false, 0).skip);
    }

    @Test public void offEndOfQueueRepeatOneAndTheSleepTimerDoNotFade() {
        assertEquals(Crossfade.Skip.OFF, Crossfade.plan(0, A1, B1, false, false, false, 0).skip);
        assertEquals(Crossfade.Skip.NO_NEXT, Crossfade.plan(4, A1, null, false, false, false, 0).skip);
        assertEquals(Crossfade.Skip.REPEAT_ONE, Crossfade.plan(4, A1, B1, false, true, false, 0).skip);
        assertEquals(Crossfade.Skip.SLEEP_TIMER, Crossfade.plan(4, A1, B1, false, false, true, 0).skip);
    }

    @Test public void aTrackShorterThanTwiceTheFadeDoesNotFade() {
        Crossfade.Side jingle = song(7_000, "Ids", "Station");
        assertEquals(Crossfade.Skip.SHORT_TRACK, Crossfade.plan(4, jingle, B1, false, false, false, 0).skip);
        assertEquals(Crossfade.Skip.SHORT_TRACK, Crossfade.plan(4, B1, jingle, false, false, false, 0).skip);
        assertTrue(Crossfade.plan(4, song(8_000, "x", "y"), B1, false, false, false, 0).fades());
    }

    @Test public void aSeekIntoTheLastStretchDoesNotStartAFadeEarly() {
        // fade point 196 s; the copy needs 2.5 s, so 193.5 s is the last moment to plan.
        assertTrue(Crossfade.plan(4, A1, B1, false, false, false, 193_500).fades());
        assertEquals(Crossfade.Skip.TOO_LATE, Crossfade.plan(4, A1, B1, false, false, false, 193_501).skip);
        assertEquals(Crossfade.Skip.TOO_LATE, Crossfade.plan(4, A1, B1, false, false, false, 199_000).skip);
    }

    @Test public void unknownLengthsDoNotFade() {
        assertEquals(Crossfade.Skip.UNKNOWN_LENGTH, Crossfade.plan(4, song(0, "a", "b"), B1, false, false, false, 0).skip);
    }

    @Test public void secondsPreferThePersonThenTheDeviceAndAreClamped() {
        assertEquals(4, Crossfade.seconds(null, null));
        assertEquals(6, Crossfade.seconds(null, 6));
        assertEquals(0, Crossfade.seconds(0, 6));
        assertEquals(12, Crossfade.seconds(30, 6));
        assertEquals(0, Crossfade.seconds(-2, null));
    }

    @Test public void theCurveIsEqualPower() {
        assertEquals(1f, Crossfade.outGain(0f), 1e-6);
        assertEquals(0f, Crossfade.inGain(0f), 1e-6);
        assertEquals(0f, Crossfade.outGain(1f), 1e-6);
        assertEquals(1f, Crossfade.inGain(1f), 1e-6);
        for (float p = 0; p <= 1f; p += 0.05f) {
            float o = Crossfade.outGain(p), i = Crossfade.inGain(p);
            assertEquals("constant power at " + p, 1f, o * o + i * i, 1e-5);
        }
        assertEquals(Crossfade.outGain(0.5f), Crossfade.inGain(0.5f), 1e-6);
    }

    @Test public void progressAndTheCutAreClamped() {
        assertEquals(0f, Crossfade.progress(-5, 4000), 0);
        assertEquals(0.5f, Crossfade.progress(2000, 4000), 1e-6);
        assertEquals(1f, Crossfade.progress(9000, 4000), 0);
        assertEquals(1f, Crossfade.cutGain(0), 0);
        assertEquals(0f, Crossfade.cutGain(Crossfade.CUT_MS), 0);
    }

    @Test public void theCopyIsPreparedFifteenSecondsAheadButNeverBeforeNow() {
        Crossfade.Plan p = Crossfade.plan(4, A1, B1, false, false, false, 10_000);
        assertEquals(181_000, Crossfade.prepareAtMs(p, 10_000));
        assertEquals(190_000, Crossfade.prepareAtMs(p, 190_000));
    }

    @Test public void theStartUpEstimateConvergesAndIsBounded() {
        assertEquals(90, Crossfade.nextLead(0, 180));     // first fade: half of 180
        assertEquals(180, Crossfade.nextLead(90, 180));   // 90 applied, still 180 behind -> measured 270
        assertEquals(180, Crossfade.nextLead(180, 0));    // on time: stays
        assertEquals(0, Crossfade.nextLead(20, -100));    // ahead: never below 0
        assertEquals(Crossfade.MAX_LEAD_MS, Crossfade.nextLead(400, 2000));
    }
}
