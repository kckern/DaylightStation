package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DownloadProgressTest {
    @Test public void rateFromTwoSamples() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 0);
        p.sample(1000, 1_200_000);
        assertEquals(1_200_000, p.bytesPerSecond());
    }

    @Test public void theRateIsOverTheLastFewSecondsOnly() {
        DownloadProgress p = new DownloadProgress();
        for (long t = 0; t <= 20_000; t += 1000) p.sample(t, t < 10_000 ? t * 1000 : 10_000_000 + (t - 10_000) * 100);
        assertEquals("the slow last seconds, not the fast start", 100_000, p.bytesPerSecond());
    }

    @Test public void fifteenSecondsWithoutBytesIsAStall() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(14_000, 5_000_000);
        assertEquals(DownloadProgress.Phase.MOVING, p.phase(14_000));
        p.sample(15_000, 5_000_000);
        assertEquals(DownloadProgress.Phase.RESTARTING, p.phase(15_000));
    }

    @Test public void theRestartIsDueOncePerStall() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(15_000, 5_000_000);
        assertTrue(p.restartDue(15_000));
        p.sample(16_000, 5_000_000);
        assertFalse("once", p.restartDue(16_000));
    }

    @Test public void stillQuietAfterTheRestartMeansWaiting() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(15_000, 5_000_000);
        p.restartDue(15_000);
        p.sample(29_000, 5_000_000);
        assertEquals(DownloadProgress.Phase.RESTARTING, p.phase(29_000));
        p.sample(30_000, 5_000_000);
        assertEquals(DownloadProgress.Phase.WAITING, p.phase(30_000));
        assertFalse("not again while it waits", p.restartDue(60_000));
    }

    @Test public void bytesComingEndsTheStallAndAllowsALaterRestart() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(15_000, 5_000_000);
        p.restartDue(15_000);
        p.sample(17_000, 5_100_000);
        assertEquals(DownloadProgress.Phase.MOVING, p.phase(17_000));
        p.sample(32_000, 5_100_000);
        assertTrue("a new stall is a new episode", p.restartDue(32_000));
    }

    @Test public void aCountThatDipsAndClimbsBackIsNotProgress() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(5_000, 4_000_000);
        p.sample(10_000, 5_000_000);
        p.sample(15_000, 4_800_000);
        assertEquals(DownloadProgress.Phase.RESTARTING, p.phase(15_000));
        p.sample(16_000, 5_000_001);
        assertEquals("past the most seen it moves again", DownloadProgress.Phase.MOVING, p.phase(16_000));
    }

    @Test public void aCountThatWentDownStartsOver() {
        DownloadProgress p = new DownloadProgress();
        p.sample(0, 5_000_000);
        p.sample(1000, 6_000_000);
        p.sample(2000, 100_000);
        assertEquals(0, p.bytesPerSecond());
    }

    @Test public void theLineSaysMegabytesAndRate() {
        DownloadProgress.Phase m = DownloadProgress.Phase.MOVING;
        assertEquals("12.4 of 40.1 MB · 1.2 MB/s", DownloadProgress.line(12_400_000, 40_100_000, 1_200_000, m));
        assertEquals("12.4 of 40.1 MB", DownloadProgress.line(12_400_000, 40_100_000, 0, m));
        assertEquals("12.4 of 40.1 MB · Stalled · restarting",
                DownloadProgress.line(12_400_000, 40_100_000, 0, DownloadProgress.Phase.RESTARTING));
        assertEquals("12.4 of 40.1 MB · Stalled · will retry when the connection improves",
                DownloadProgress.line(12_400_000, 40_100_000, 0, DownloadProgress.Phase.WAITING));
    }

    @Test public void anUnknownTotalIsNeverAPercentageOrAnOf() {
        DownloadProgress.Phase m = DownloadProgress.Phase.MOVING;
        assertEquals("12.4 MB · 640 KB/s", DownloadProgress.line(12_400_000, 0, 640_000, m));
        assertEquals("12.4 MB · 640 KB/s", DownloadProgress.line(12_400_000, -1, 640_000, m));
        assertEquals("nothing yet is not 0.0 MB", "Downloading…", DownloadProgress.line(0, 0, 0, m));
        assertEquals("0.0 of 40.1 MB", DownloadProgress.line(0, 40_100_000, 0, m));
    }

    @Test public void numbersAreDecimalWithADotInEveryLocale() {
        java.util.Locale was = java.util.Locale.getDefault();
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY);
            assertEquals("1.5 of 3.0 MB", DownloadProgress.line(1_500_000, 3_000_000, 0, DownloadProgress.Phase.MOVING));
        } finally {
            java.util.Locale.setDefault(was);
        }
    }
}
