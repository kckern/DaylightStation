package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

/** The long-form rules after audiobookshelf: speed per collection, never on music; resume rewind; fade. */
public class LongFormTest {
    private static final class Memory implements LongForm.SpeedMemory {
        final Map<String, Float> m = new HashMap<>();
        @Override public float get(String key, float fallback) { return m.getOrDefault(key, fallback); }
        @Override public void put(String key, float speed) { m.put(key, speed); }
    }

    @Test public void musicIsNeverSpedUp() {
        Memory mem = new Memory();
        LongForm.remember("album:a book", 1.5f, mem);
        assertEquals(1f, LongForm.speedFor(false, "album:a book", mem), 0);
        assertEquals(1f, LongForm.speedFor(false, "", mem), 0);
    }

    @Test public void aSpeedIsRememberedPerCollectionAndBecomesTheDefault() {
        Memory mem = new Memory();
        assertEquals("nothing chosen yet", 1f, LongForm.speedFor(true, "list:talks", mem), 0);
        LongForm.remember("list:talks", 1.5f, mem);
        LongForm.remember("album:a novel", 1.1f, mem);
        assertEquals(1.5f, LongForm.speedFor(true, "list:talks", mem), 0);
        assertEquals(1.1f, LongForm.speedFor(true, "album:a novel", mem), 0);
        assertEquals("a new collection starts at the latest choice", 1.1f, LongForm.speedFor(true, "album:new course", mem), 0);
        assertEquals(1.1f, LongForm.speedFor(true, "", mem), 0);
    }

    @Test public void collectionKeys() {
        assertEquals("list:abc", LongForm.speedKey("abc", "Some Album"));
        assertEquals("album:some album", LongForm.speedKey("", " Some Album "));
        assertEquals("", LongForm.speedKey(null, null));
    }

    @Test public void speedsAreClampedAndLabelled() {
        assertEquals(3f, LongForm.clampSpeed(9f), 0);
        assertEquals(0.5f, LongForm.clampSpeed(0.1f), 0);
        assertEquals(1f, LongForm.clampSpeed(Float.NaN), 0);
        assertEquals("1×", LongForm.speedLabel(1f));
        assertEquals("1.2×", LongForm.speedLabel(1.2f));
        assertEquals("1.25×", LongForm.speedLabel(1.25f));
    }

    @Test public void resumeStepsBackMoreTheLongerThePause() {
        assertEquals(0, LongForm.resumeRewindMs(5_000));
        assertEquals(3_000, LongForm.resumeRewindMs(30_000));
        assertEquals(10_000, LongForm.resumeRewindMs(4 * 60_000));
        assertEquals(20_000, LongForm.resumeRewindMs(20 * 60_000));
        assertEquals(30_000, LongForm.resumeRewindMs(5 * 3_600_000L));
    }

    @Test public void timeLeftIsCountedAtTheSpeed() {
        assertEquals(60_000, LongForm.remainingAtSpeed(0, 90_000, 1.5f));
        assertEquals("−1:00", TrackDetail.TimeDisplay.REMAINING.right(0, 90_000, 1.5f));
        assertEquals("1:30", TrackDetail.TimeDisplay.TOTAL.right(0, 90_000, 1.5f));
    }

    @Test public void theSleepFadeIsTheLastMinuteDownToATenth() {
        assertEquals(1f, LongForm.fadeVolume(120_000), 0);
        assertEquals(1f, LongForm.fadeVolume(60_000), 0);
        assertEquals(0.55f, LongForm.fadeVolume(30_000), 0.001);
        assertEquals(0.1f, LongForm.fadeVolume(0), 0.001);
    }
}
