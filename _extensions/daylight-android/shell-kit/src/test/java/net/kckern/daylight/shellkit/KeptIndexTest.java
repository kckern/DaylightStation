package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;

public class KeptIndexTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void aKeptCollectionIsOnThePhoneOnlyWhenWhollyDownloaded() throws Exception {
        java.io.File dir = tmp.newFolder();
        JSONObject book = new JSONObject().put("contentId", "plex:10").put("title", "A book")
                .put("trackIds", new JSONArray().put("plex:11").put("plex:12")).put("done", 1).put("total", 2).put("bytes", 40_000_000L);
        KeptIndex.write(dir, new JSONArray().put(book), 2048);
        List<JSONObject> index = KeptIndex.read(dir);
        assertFalse("half downloaded is not playable offline", KeptIndex.onPhone(index, "plex:12"));
        assertEquals("Downloading 1 of 2", KeptIndex.describe(index.get(0)));
        book.put("done", 2);
        KeptIndex.write(dir, new JSONArray().put(book), 2048);
        index = KeptIndex.read(dir);
        assertTrue(KeptIndex.onPhone(index, "plex:12"));
        assertTrue(KeptIndex.onPhone(index, "plex:10"));
        assertEquals("On this phone · 40 MB", KeptIndex.describe(index.get(0)));
        assertEquals(2048, KeptIndex.capMb(dir));
        assertEquals(40_000_000L, KeptIndex.usedBytes(index));
    }

    @Test public void theCapIsInMegabytesAndZeroMeansNone() {
        assertTrue(KeptIndex.fits(4096, 4_000_000_000L, 90_000_000L));
        assertFalse(KeptIndex.fits(4096, 4_000_000_000L, 100_000_000L));
        assertTrue(KeptIndex.fits(0, Long.MAX_VALUE / 2, 1));
        assertEquals("1.2 GB", KeptIndex.size(1_234_000_000L));
        assertEquals("1 MB", KeptIndex.size(10));
    }

    @Test public void failuresAndWaitingAreSaid() throws Exception {
        assertEquals("1 of 3 did not download", KeptIndex.describe(new JSONObject().put("done", 2).put("total", 3).put("failed", 1)));
        assertEquals("Waiting for Wi-Fi", KeptIndex.describe(new JSONObject().put("done", 0).put("total", 3).put("waiting", true)));
    }

    private static org.json.JSONObject item(String state) throws Exception {
        return new org.json.JSONObject().put("state", state);
    }

    /** The spec's §2: one state machine, the exact words. */
    @Test public void everyStateSaysTheSpecsWords() throws Exception {
        assertEquals("Checking size…", KeptIndex.describe(item(KeptIndex.CHECKING)));
        assertEquals("Needs 1.2 GB more room", KeptIndex.describe(item(KeptIndex.NEEDS_ROOM).put("needBytes", 1_200_000_000L)));
        assertEquals("Queued", KeptIndex.describe(item(KeptIndex.QUEUED)));
        assertEquals("Waiting for Wi-Fi", KeptIndex.describe(item(KeptIndex.WAITING_WIFI)));
        assertEquals("Waiting for home", KeptIndex.describe(item(KeptIndex.WAITING_HOME)));
        assertEquals("Phone storage is full", KeptIndex.describe(item(KeptIndex.WAITING_STORAGE)));
        assertEquals("Downloading 3 of 12 · 84 MB of 230 MB", KeptIndex.describe(item(KeptIndex.DOWNLOADING)
                .put("done", 3).put("total", 12).put("bytes", 84_000_000L).put("expectedBytes", 230_000_000L)));
        assertEquals("Paused", KeptIndex.describe(item(KeptIndex.PAUSED)));
        assertEquals("11 of 12 ready · 1 couldn't download: Gone from the library", KeptIndex.describe(item(KeptIndex.PARTLY_READY)
                .put("done", 11).put("total", 12).put("failed", 1).put("reason", "Gone from the library")));
        assertEquals("On this phone · 230 MB", KeptIndex.describe(item(KeptIndex.READY).put("bytes", 230_000_000L)));
        assertEquals("Finished · 230 MB", KeptIndex.describe(item(KeptIndex.READY).put("bytes", 230_000_000L).put("finished", true)));
        assertEquals("Updating: 2 new", KeptIndex.describe(item(KeptIndex.UPDATING).put("done", 10).put("total", 12)));
        assertEquals("Removing…", KeptIndex.describe(item(KeptIndex.REMOVING)));
        assertEquals("On the SD card — not inserted", KeptIndex.describe(item(KeptIndex.NOT_AVAILABLE)));
        assertEquals("1 track needs downloading again", KeptIndex.describe(item(KeptIndex.DAMAGED).put("damaged", 1)));
    }

    @Test public void eachItemHasOneStateInPriorityOrder() {
        KeptIndex.Facts f = new KeptIndex.Facts();
        f.total = 12; f.done = 12;
        assertEquals(KeptIndex.READY, f.state());
        f.damaged = 1;
        assertEquals("a damaged file is not ready", KeptIndex.DAMAGED, f.state());
        f.damaged = 0; f.done = 11; f.failed = 1;
        assertEquals(KeptIndex.PARTLY_READY, f.state());
        f.failed = 0; f.wasReady = true;
        assertEquals("a ready list that gained a track is updating", KeptIndex.UPDATING, f.state());
        f.wasReady = false; f.moving = 1;
        assertEquals(KeptIndex.DOWNLOADING, f.state());
        f.waitingNetwork = true;
        assertEquals(KeptIndex.WAITING_WIFI, f.state());
        f.paused = true;
        assertEquals(KeptIndex.PAUSED, f.state());
        f.notAvailable = true;
        assertEquals("a missing card wins: never deleted, never downloading", KeptIndex.NOT_AVAILABLE, f.state());
        f.removing = true;
        assertEquals(KeptIndex.REMOVING, f.state());
        assertEquals("refused", KeptIndex.reportState(KeptIndex.NEEDS_ROOM));
        assertEquals("failed", KeptIndex.reportState(KeptIndex.PARTLY_READY));
        assertEquals("queued", KeptIndex.reportState(KeptIndex.WAITING_HOME));
    }

    @Test public void eachRowOffersTheRightAction() throws Exception {
        assertEquals("Retry", KeptIndex.action(item(KeptIndex.PARTLY_READY)));
        assertEquals("Resume", KeptIndex.action(item(KeptIndex.PAUSED)));
        assertEquals("Manage space", KeptIndex.action(item(KeptIndex.NEEDS_ROOM)));
        assertEquals("Use mobile data once", KeptIndex.action(item(KeptIndex.WAITING_WIFI)));
        assertEquals("", KeptIndex.action(item(KeptIndex.READY)));
    }

    /** S1, S2, 3.7: room visible; the limit never above free space minus 2 GB. */
    @Test public void roomIsShownAndTheLimitRespectsFreeSpace() {
        assertEquals("1.2 GB kept · 4.1 GB limit · 15.0 GB free on phone", KeptIndex.roomLine(1_200_000_000L, 4096, 15_000_000_000L));
        // The owner's phone: 15 GB free, a 4 GB setting: the setting applies.
        assertEquals(4_096_000_000L, KeptIndex.effectiveLimitBytes(4096, 15_000_000_000L, 1_000_000_000L));
        // 3 GB free: what is kept plus 1 GB.
        assertEquals(2_000_000_000L, KeptIndex.effectiveLimitBytes(4096, 3_000_000_000L, 1_000_000_000L));
        assertEquals("Over the limit by 600 MB: new keeps wait until there is room",
                KeptIndex.overLine(1_000_000_000L, 1_600_000_000L));
        assertEquals("", KeptIndex.overLine(4_000_000_000L, 1_000_000_000L));
        java.util.List<org.json.JSONObject> l = new java.util.ArrayList<>();
        try {
            l.add(new org.json.JSONObject().put("bytes", 5));
            l.add(new org.json.JSONObject().put("bytes", 50));
        } catch (Exception e) { throw new AssertionError(e); }
        KeptIndex.largestFirst(l);
        assertEquals(50, l.get(0).optLong("bytes"));
    }

    @Test public void aRefusedTelemetryBatchIsDroppedNotRetriedForever() throws Exception {
        assertEquals(UiTelemetry.SENT, UiTelemetry.outcome(new org.json.JSONObject().put("ok", true)));
        assertEquals(UiTelemetry.REFUSED, UiTelemetry.outcome(new org.json.JSONObject().put("ok", false).put("status", 400)));
        assertEquals(UiTelemetry.REFUSED, UiTelemetry.outcome(new org.json.JSONObject().put("ok", false).put("status", 413)));
        assertEquals(UiTelemetry.LATER, UiTelemetry.outcome(new org.json.JSONObject().put("ok", false).put("status", 429)));
        assertEquals(UiTelemetry.LATER, UiTelemetry.outcome(new org.json.JSONObject().put("ok", false).put("status", 503)));
        assertEquals(UiTelemetry.LATER, UiTelemetry.outcome(new org.json.JSONObject().put("ok", false).put("status", 0)));
    }

    @Test public void aCoverThatFailedWaitsAMinuteDoublingToADay() {
        assertEquals(1_000 + 60_000, PlaylistArtwork.nextTry(1, 1_000));
        assertEquals(1_000 + 120_000, PlaylistArtwork.nextTry(2, 1_000));
        assertEquals(1_000 + 86_400_000L, PlaylistArtwork.nextTry(30, 1_000));
    }

    @Test public void aLoweredCapDeletesNothingAndSaysHowFarOver() {
        assertEquals(500_000_000L, KeptIndex.overCap(1000, 1_500_000_000L));
        assertEquals(0, KeptIndex.overCap(0, 9_000_000_000L));
        assertEquals(0, KeptIndex.overCap(4096, 1_000_000L));
    }
}
