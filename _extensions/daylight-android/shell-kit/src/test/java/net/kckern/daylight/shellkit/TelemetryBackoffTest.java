package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

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
        assertEquals(TelemetrySchedule.MAX_RETRY_MS, TelemetrySchedule.retryMs(a.failedRuns()));
    }
}
