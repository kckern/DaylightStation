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
        assertEquals("2 tracks · 40 MB", KeptIndex.describe(index.get(0)));
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
        assertEquals("Waiting for Wi-Fi · 0 of 3", KeptIndex.describe(new JSONObject().put("done", 0).put("total", 3).put("waiting", true)));
    }

    @Test public void eachCollectionHasOneStateAndSaysIt() throws Exception {
        assertEquals(KeptIndex.READY, KeptIndex.stateOf(12, 12, 0, true, false, false));
        assertEquals(KeptIndex.WAITING_HOME, KeptIndex.stateOf(0, 0, 0, false, false, true));
        assertEquals(KeptIndex.FAILED, KeptIndex.stateOf(10, 12, 2, false, false, false));
        assertEquals("some failed but others still moving is downloading",
                KeptIndex.DOWNLOADING, KeptIndex.stateOf(5, 12, 2, false, false, false));
        assertEquals(KeptIndex.WAITING_WIFI, KeptIndex.stateOf(3, 12, 0, true, false, false));
        assertEquals(KeptIndex.WAITING_STORAGE, KeptIndex.stateOf(3, 12, 0, false, true, false));
        assertEquals("queued", KeptIndex.reportState(KeptIndex.WAITING_WIFI));
        assertEquals("failed", KeptIndex.reportState(KeptIndex.FAILED));
        org.json.JSONObject failed = new org.json.JSONObject().put("state", "failed").put("done", 10).put("total", 12)
                .put("failed", 2).put("reason", "Home not reachable");
        assertEquals("2 of 12 failed: Home not reachable", KeptIndex.describe(failed));
        assertTrue(KeptIndex.retryable(failed));
        assertEquals("Waiting for home", KeptIndex.describe(new org.json.JSONObject().put("state", "waiting-home")));
    }

    @Test public void aLoweredCapDeletesNothingAndSaysHowFarOver() {
        assertEquals(500_000_000L, KeptIndex.overCap(1000, 1_500_000_000L));
        assertEquals(0, KeptIndex.overCap(0, 9_000_000_000L));
        assertEquals(0, KeptIndex.overCap(4096, 1_000_000L));
    }
}
