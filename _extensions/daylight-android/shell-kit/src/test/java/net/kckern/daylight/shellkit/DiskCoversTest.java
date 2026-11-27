package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class DiskCoversTest {
    @Test public void theLeastRecentlyUsedGoFirstUntilUnderBudget() {
        List<String> gone = DiskCovers.evict(Arrays.asList(
                new DiskCovers.Entry("new.img", 40, 300),
                new DiskCovers.Entry("old.img", 40, 100),
                new DiskCovers.Entry("mid.img", 40, 200)), 90);
        assertEquals(Arrays.asList("old.img"), gone);
    }

    @Test public void underBudgetNothingGoesButLeftoverTempFiles() {
        List<String> gone = DiskCovers.evict(Arrays.asList(
                new DiskCovers.Entry("a.img", 10, 1), new DiskCovers.Entry("a.img.tmp", 10, 2)), 100);
        assertEquals(Arrays.asList("a.img.tmp"), gone);
        assertTrue(DiskCovers.evict(null, 1).isEmpty());
    }
}
