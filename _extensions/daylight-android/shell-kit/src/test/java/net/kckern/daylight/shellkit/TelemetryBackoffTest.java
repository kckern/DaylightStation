package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class TelemetryBackoffTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void startsAtZeroWithNoFile() throws Exception {
        assertEquals(0, new TelemetryBackoff(new File(tmp.getRoot(), "backoff.txt")).failedRuns());
    }

    @Test public void aRunThatLeftBatchesCountsAndSurvivesARestart() throws Exception {
        File f = new File(tmp.getRoot(), "backoff.txt");
        TelemetryBackoff a = new TelemetryBackoff(f);
        assertEquals(1, a.ran(true));
        assertEquals(2, a.ran(true));
        TelemetryBackoff afterRestart = new TelemetryBackoff(f);
        assertEquals(2, afterRestart.failedRuns());
        assertEquals(3, afterRestart.ran(true));
        assertEquals(TelemetrySchedule.retryMs(3), TelemetrySchedule.retryMs(new TelemetryBackoff(f).failedRuns()));
    }

    @Test public void aCleanRunResetsAndRemovesTheFile() throws Exception {
        File f = new File(tmp.getRoot(), "backoff.txt");
        TelemetryBackoff a = new TelemetryBackoff(f);
        a.ran(true);
        assertEquals(0, a.ran(false));
        assertFalse(f.exists());
        assertEquals(0, new TelemetryBackoff(f).failedRuns());
    }

    @Test public void aTornOrAbsurdFileReadsAsAFreshStart() throws Exception {
        File f = new File(tmp.getRoot(), "backoff.txt");
        Files.write(f.toPath(), "garb".getBytes(StandardCharsets.UTF_8));
        assertEquals(0, new TelemetryBackoff(f).failedRuns());
        Files.write(f.toPath(), "-5".getBytes(StandardCharsets.UTF_8));
        assertEquals(0, new TelemetryBackoff(f).failedRuns());
    }

    @Test public void theCountStopsWhereTheWaitStopsGrowing() throws Exception {
        File f = new File(tmp.getRoot(), "backoff.txt");
        TelemetryBackoff a = new TelemetryBackoff(f);
        for (int i = 0; i < 500; i++) a.ran(true);
        assertEquals(TelemetryBackoff.MAX_RUNS, a.failedRuns());
        assertEquals(TelemetrySchedule.MAX_RETRY_MS, TelemetrySchedule.retryMs(TelemetryBackoff.MAX_RUNS));
        assertTrue(TelemetrySchedule.retryMs(TelemetryBackoff.MAX_RUNS - 1) < TelemetrySchedule.MAX_RETRY_MS);
        assertEquals(TelemetrySchedule.MAX_RETRY_MS, TelemetrySchedule.retryMs(a.failedRuns()));
    }

    @Test public void twoThreadsRanningAtOnceStayInRangeAndNeverThrow() throws Exception {
        File f = new File(tmp.getRoot(), "backoff.txt");
        TelemetryBackoff a = new TelemetryBackoff(f);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure = new java.util.concurrent.atomic.AtomicReference<>();
        Runnable work = () -> {
            try { for (int i = 0; i < 300; i++) { int n = a.ran(i % 7 != 0); if (n < 0 || n > TelemetryBackoff.MAX_RUNS) throw new AssertionError(n); } }
            catch (Throwable t) { failure.set(t); }
        };
        Thread t1 = new Thread(work), t2 = new Thread(work);
        t1.start(); t2.start(); t1.join(); t2.join();
        assertEquals(null, failure.get());
        int onDisk = new TelemetryBackoff(f).failedRuns();
        assertTrue(onDisk >= 0 && onDisk <= TelemetryBackoff.MAX_RUNS);
        assertEquals("the file agrees with memory", a.failedRuns(), onDisk);
    }
}
