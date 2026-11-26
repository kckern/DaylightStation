package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.HttpDataSource;

import org.junit.Test;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Collections;

/** Plan A, C, K: retries back off and stop on a permanent failure; reasons are words; stalls are seen; no byte on a forbidden network. */
public class KeepRulesTest {
    @Test public void aFailedTrackIsTriedAgainAfterAMinuteTenMinutesAnHourThenDaily() {
        assertEquals(1_000 + 60_000, KeepRules.retryAt(1, 1_000));
        assertEquals(1_000 + 600_000, KeepRules.retryAt(2, 1_000));
        assertEquals(1_000 + 3_600_000, KeepRules.retryAt(3, 1_000));
        assertEquals(1_000 + 86_400_000L, KeepRules.retryAt(4, 1_000));
        assertEquals(1_000 + 86_400_000L, KeepRules.retryAt(40, 1_000));
        assertTrue(KeepRules.permanent(404));
        assertFalse(KeepRules.permanent(503));
    }

    @Test public void aFailureSaysWhyInWordsAPersonCanActOn() {
        DataSpec spec = null;   // no android.net.Uri in a JVM test; the reason reads only the status
        assertEquals(KeepRules.GONE, KeepRules.reasonFor(new HttpDataSource.InvalidResponseCodeException(
                404, "Not Found", null, Collections.emptyMap(), spec, new byte[0])));
        assertEquals(KeepRules.REFUSED, KeepRules.reasonForStatus(401));
        assertEquals(KeepRules.HOME_PROBLEM, KeepRules.reasonForStatus(502));
        assertEquals(KeepRules.UNREACHABLE, KeepRules.reasonFor(new IOException("x", new UnknownHostException("h"))));
        assertEquals(KeepRules.UNREACHABLE, KeepRules.reasonFor(new SocketTimeoutException()));
        assertEquals(KeepRules.FULL, KeepRules.reasonFor(new IOException("write failed: ENOSPC (No space left on device)")));
        assertTrue("a full phone's partial file is not resumed onto", KeepRules.discardPartial(KeepRules.FULL));
        assertFalse(KeepRules.discardPartial(KeepRules.UNREACHABLE));
    }

    @Test public void aDownloadWithNoBytesFor30MinutesWhileAllowedHasStalled() {
        long t = 10_000_000;
        assertTrue(KeepRules.stalled(true, true, t, t + KeepRules.STALL_MS));
        assertFalse(KeepRules.stalled(true, true, t, t + KeepRules.STALL_MS - 1));
        assertFalse("waiting for Wi-Fi is not a stall", KeepRules.stalled(true, false, t, t + 2 * KeepRules.STALL_MS));
        assertFalse(KeepRules.stalled(false, true, t, t + 2 * KeepRules.STALL_MS));
    }

    @Test public void mobileDataCarriesNoKeepByteUnlessAllowed() {
        assertTrue(KeepRules.networkAllows(true, false, false));
        assertFalse(KeepRules.networkAllows(true, true, false));
        assertTrue(KeepRules.networkAllows(true, true, true));
        assertFalse(KeepRules.networkAllows(false, false, true));
    }

    @Test public void aKeepOverAQuarterOfTheSpaceIsAskedAbout() {
        assertTrue(KeepRules.askFirst(1_100_000_000L, 4096));
        assertFalse(KeepRules.askFirst(900_000_000L, 4096));
        assertFalse("no cap, nothing to weigh", KeepRules.askFirst(9_000_000_000L, 0));
    }
}
