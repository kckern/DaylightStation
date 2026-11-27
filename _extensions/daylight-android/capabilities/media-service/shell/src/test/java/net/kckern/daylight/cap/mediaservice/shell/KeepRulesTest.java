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

    @Test public void aClockSetBackNeverMakesSomethingWaitForever() {
        assertEquals(500, KeepRules.notAfterNow(9_000, 500));
        // Failed "in the future" (the clock was set back): the wait counts from now, not from then.
        long now = 61_000;
        assertFalse(KeepRules.retryDue(1, 10_000_000, now));
        assertEquals(now + 60_000, KeepRules.retryAt(1, KeepRules.notAfterNow(10_000_000, now)));
        assertFalse(KeepRules.retryDue(1, 1_000, 1_000 + 59_999));
        assertTrue(KeepRules.removeFinishedDue(1_000, 1_000 + KeepRules.DAY_MS));
        assertFalse(KeepRules.removeFinishedDue(99 * KeepRules.DAY_MS, 1_000));
    }

    @Test public void a404IsPermanentOnlyAfterAFreshUrlAlsoFails() {
        assertFalse(KeepRules.permanentAfter(404, false));
        assertTrue(KeepRules.permanentAfter(404, true));
        assertFalse(KeepRules.permanentAfter(503, true));
    }

    @Test public void onlyAudioIsStoredAsATrack() {
        assertTrue(KeepRules.looksLikeAudio("ID3\u0004xxxx".getBytes()));
        assertTrue(KeepRules.looksLikeAudio(new byte[] { (byte) 0xFF, (byte) 0xFB, 0x50, 0x00 }));
        assertTrue(KeepRules.looksLikeAudio("fLaC....".getBytes()));
        assertTrue(KeepRules.looksLikeAudio(new byte[] { 0, 0, 0, 0x20, 'f', 't', 'y', 'p', 'M', '4', 'A' }));
        assertFalse(KeepRules.looksLikeAudio("<!DOCTYPE html>".getBytes()));
        assertFalse(KeepRules.looksLikeAudio("{\"error\":1}".getBytes()));
    }

    @Test public void aMissingCardIsNotAvailableNeverDeleted() {
        assertEquals(KeepRules.SD, KeepRules.location("sd", true, "internal"));
        assertEquals(KeepRules.SD_MISSING, KeepRules.location("sd", false, "sd"));
        assertEquals("downloads on a card that is out stay there", KeepRules.SD_MISSING, KeepRules.location("internal", false, "sd"));
        assertEquals(KeepRules.INTERNAL, KeepRules.location("internal", false, "internal"));
    }

    @Test public void keepSaysWhatItKeepsAndTheRoom() {
        assertEquals("Keep the book · 14 parts", KeepRules.keepWords("book", 14));
        assertEquals("Keep the album · 12 tracks", KeepRules.keepWords("album", 12));
        assertEquals("Keep the playlist · 230 tracks (updates when it changes)", KeepRules.keepWords("playlist", 230));
        assertEquals("1.2 GB · 13.8 GB left · on Wi-Fi", KeepRules.roomWords(1_200_000_000L, 13_800_000_000L, true));
        assertTrue(KeepRules.askFirst(1_100_000_000L, 4_000_000_000L, 15_000_000_000L));
        assertTrue("a quarter of the free space asks too", KeepRules.askFirst(600_000_000L, 40_000_000_000L, 2_000_000_000L));
        assertFalse(KeepRules.askFirst(100_000_000L, 4_000_000_000L, 15_000_000_000L));
    }

    // ── keeps waiting for home ───────────────────────────────────────────────

    @Test public void aWaitingKeepShowsAsTheContentItWasAskedFor() {
        assertEquals("plex:42", KeepRules.pendingContentId("c:plex:42"));
        assertEquals("plex:7", KeepRules.pendingContentId("p:plex:7|album"));
        assertEquals("plex:7", KeepRules.pendingContentId("p:plex:7"));
        assertEquals("plex:9", KeepRules.pendingContentId("plex:9"));
        assertEquals("", KeepRules.pendingContentId(null));
    }

    @Test public void removingAWaitingRowMadeFromNowPlayingRemovesItsPEntry() {
        java.util.List<String> pending = java.util.Arrays.asList("c:plex:42", "p:plex:7|album", "p:plex:8");
        // The row shows contentId plex:7; removing it must drop the p: entry, or it comes back on refresh.
        assertEquals(java.util.Arrays.asList("c:plex:42", "p:plex:8"), KeepRules.pendingWithout(pending, "plex:7"));
        assertEquals(java.util.Arrays.asList("p:plex:7|album", "p:plex:8"), KeepRules.pendingWithout(pending, "plex:42"));
        assertEquals(pending, KeepRules.pendingWithout(pending, "plex:99"));
    }

    @Test public void aSizeHomeDidNotGiveIsSaidNeverCountedAsNothing() {
        assertEquals("size unknown", KeepRules.needWords(0, 3));
        assertEquals("at least 1.2 GB", KeepRules.needWords(1_200_000_000L, 2));
        assertEquals(KeepRules.sizeWords(1_200_000_000L), KeepRules.needWords(1_200_000_000L, 0));
        assertEquals("size unknown · on Wi-Fi", KeepRules.roomWords(0, 4, 10_000_000_000L, true));
        assertTrue(KeepRules.roomWords(500_000_000L, 1, 10_000_000_000L, false).startsWith("at least "));
        assertEquals(KeepRules.roomWords(500_000_000L, 10_000_000_000L, true), KeepRules.roomWords(500_000_000L, 0, 10_000_000_000L, true));
    }

    @Test public void theNotificationNamesTheNeedThatIsNotMet() {
        assertEquals("Waiting: phone storage is low",
                KeepRules.waitingWords(androidx.media3.exoplayer.scheduler.Requirements.DEVICE_STORAGE_NOT_LOW
                        | androidx.media3.exoplayer.scheduler.Requirements.NETWORK_UNMETERED));
        assertEquals("Waiting for Wi-Fi", KeepRules.waitingWords(androidx.media3.exoplayer.scheduler.Requirements.NETWORK_UNMETERED));
        assertEquals("Waiting for a network", KeepRules.waitingWords(androidx.media3.exoplayer.scheduler.Requirements.NETWORK));
        assertEquals("Waiting for the charger", KeepRules.waitingWords(androidx.media3.exoplayer.scheduler.Requirements.DEVICE_CHARGING));
        assertEquals("Waiting", KeepRules.waitingWords(0));
    }
}
