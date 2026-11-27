package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public class CoverCacheTest {
    @Test public void rowAndMiniPlayerSizesShareOneCopy() {
        assertEquals(CoverCache.bucket(144), CoverCache.bucket(160));
        assertEquals(360, CoverCache.bucket(320));
        assertEquals(900, CoverCache.bucket(900));
        assertEquals(1200, CoverCache.bucket(1200));
    }

    @Test public void keysCarryUrlAndSizeAndSplitBack() {
        String k = CoverCache.key("https://h/a@b.jpg", 360);
        assertNotEquals(CoverCache.key("https://h/a@b.jpg", 160), k);
        assertArrayEquals(new String[] { "https://h/a@b.jpg", "360" }, CoverCache.split(k));
        assertNull(CoverCache.split("https://h/x.jpg"));
    }

    @Test public void aLargerCopyAnswersASmallerRequest() {
        Set<Integer> sizes = new HashSet<>(Arrays.asList(360, 900));
        assertEquals(Integer.valueOf(360), CoverCache.pick(sizes, 144, false));
        assertEquals(Integer.valueOf(900), CoverCache.pick(sizes, 600, false));
    }

    @Test public void aSmallerCopyOnlyWhenAnySizeWillDo() {
        Set<Integer> sizes = new HashSet<>(Arrays.asList(160, 360));
        assertNull("Now playing's 900 is not answered by a row's cover", CoverCache.pick(sizes, 900, false));
        assertEquals("but it draws the largest at once", Integer.valueOf(360), CoverCache.pick(sizes, 900, true));
        assertNull(CoverCache.pick(new HashSet<>(), 160, true));
    }

    @Test public void budgetIsAnEighthCappedAt32Mb() {
        assertEquals(16 * 1024 * 1024, CoverCache.budgetBytes(128L * 1024 * 1024));
        assertEquals(CoverCache.CAP_BYTES, CoverCache.budgetBytes(512L * 1024 * 1024));
        assertEquals(4 * 1024 * 1024, CoverCache.budgetBytes(8L * 1024 * 1024));
    }

    @Test public void aFailedCoverWaitsItsBackoff() {
        assertTrue(CoverCache.mayTry(null, 0));
        long[] once = CoverCache.failedAgain(null, 1_000);
        assertEquals(1, once[0]);
        assertFalse("offline: not fetched again on the next draw", CoverCache.mayTry(once, 2_000));
        assertTrue(CoverCache.mayTry(once, 61_000));
        long[] twice = CoverCache.failedAgain(once, 61_000);
        assertFalse(CoverCache.mayTry(twice, 61_000 + 60_000));
        assertTrue(CoverCache.mayTry(twice, 61_000 + 120_000));
    }

    @Test public void aFailureStampedInTheFutureCountsFromNow() {
        long[] f = { 1, 10_000_000 };
        assertFalse(CoverCache.mayTry(f, 1_000));
        assertTrue(CoverCache.mayTry(f, 1_000 + 60_000) || CoverCache.mayTry(f, 10_000_000 + 60_000));
    }
}
