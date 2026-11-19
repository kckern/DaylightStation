package net.kckern.daylight.cap.volume;

import static org.junit.Assert.*;

import org.junit.Test;

public class VolumeMathTest {
    @Test public void aPercentageMapsOntoTheIndexRangeRoundingDown() {
        assertEquals(0, VolumeMath.indexFor(0, 15));
        assertEquals(7, VolumeMath.indexFor(50, 15));      // 7.5 rounds down, as Fully does
        assertEquals(14, VolumeMath.indexFor(99, 15));
        assertEquals(15, VolumeMath.indexFor(100, 15));
        assertEquals(0, VolumeMath.indexFor(6, 15));       // 0.9 rounds down to silence
        assertEquals(12, VolumeMath.indexFor(50, 25));
    }

    @Test public void outOfRangeInputIsClamped() {
        assertEquals(0, VolumeMath.indexFor(-20, 15));
        assertEquals(15, VolumeMath.indexFor(250, 15));
        assertEquals(0, VolumeMath.indexFor(50, 0));
        assertEquals(0, VolumeMath.levelFor(3, 0));
        assertEquals(100, VolumeMath.levelFor(99, 15));
    }

    @Test public void theLevelReadBackSetsTheSameIndexAgain() {
        // If the read-back rounded down too, writing a read value back would lower the
        // volume one step each time. Read-back rounds up so the pair is stable.
        for (int max : new int[] { 1, 7, 15, 25, 30, 100 }) {
            for (int index = 0; index <= max; index++) {
                assertEquals("max " + max + " index " + index, index, VolumeMath.indexFor(VolumeMath.levelFor(index, max), max));
            }
        }
        assertEquals(47, VolumeMath.levelFor(7, 15));
        assertEquals(100, VolumeMath.levelFor(15, 15));
        assertEquals(0, VolumeMath.levelFor(0, 15));
    }

    @Test public void streamsAre0To10() {
        assertEquals(3, VolumeMath.stream(null));
        assertEquals(3, VolumeMath.stream("3"));
        assertEquals(4, VolumeMath.stream(4));
        for (Object bad : new Object[] { "music", -1, 11, "11", 2.5 }) {
            try { VolumeMath.stream(bad); fail("expected rejection of " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void aLevelUnderTheStreamsMinimumBecomesTheMinimum() {
        assertEquals(1, VolumeMath.indexFor(0, 1, 7));
        assertEquals(1, VolumeMath.indexFor(5, 1, 7));
        assertEquals(3, VolumeMath.indexFor(50, 1, 7));
        assertEquals(7, VolumeMath.indexFor(100, 1, 7));
        assertEquals("a minimum of 0 changes nothing", VolumeMath.indexFor(40, 15), VolumeMath.indexFor(40, 0, 15));
        assertEquals("a minimum above the maximum is held to it", 7, VolumeMath.indexFor(0, 9, 7));
    }
}
