package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public class LiveDownloadTest {
    private static LiveDownload live(int done, int tracks, long bytes, long total, long rate, DownloadProgress.Phase p) {
        return new LiveDownload(done + 1, tracks, done, "album", bytes, total, rate, p);
    }

    @Test public void aRowSaysWhichTrackAndItsBytes() {
        assertEquals("Track 1 of 2 · 12.4 of 40.1 MB · 1.2 MB/s",
                live(0, 2, 12_400_000, 40_100_000, 1_200_000, DownloadProgress.Phase.MOVING).words());
    }

    @Test public void aBookSaysPartAndASingleItemSaysNoCount() {
        assertEquals("Part 2 of 5 · 1.0 of 2.0 MB",
                new LiveDownload(2, 5, 1, "book", 1_000_000, 2_000_000, 0, DownloadProgress.Phase.MOVING).words());
        assertEquals("1.0 of 2.0 MB", live(0, 1, 1_000_000, 2_000_000, 0, DownloadProgress.Phase.MOVING).words());
    }

    @Test public void theBarIsTheFinishedTracksPlusThePartOfThisOne() {
        assertEquals(0.125, live(0, 2, 10, 40, 0, DownloadProgress.Phase.MOVING).fraction(), 0.0001);
        assertEquals(0.625, live(1, 2, 10, 40, 0, DownloadProgress.Phase.MOVING).fraction(), 0.0001);
    }

    @Test public void anUnknownTotalHasNoFractionSoTheBarIsIndeterminate() {
        assertEquals(-1, live(0, 2, 10_000_000, 0, 1000, DownloadProgress.Phase.MOVING).fraction(), 0);
    }

    @Test public void aStalledItemSaysSoAndAsksForRetry() {
        LiveDownload l = live(0, 1, 12_400_000, 40_100_000, 0, DownloadProgress.Phase.WAITING);
        assertTrue(l.stalled());
        assertEquals("12.4 of 40.1 MB · Stalled · will retry when the connection improves", l.words());
        assertFalse(live(0, 1, 1, 2, 0, DownloadProgress.Phase.MOVING).stalled());
    }

    @Test public void theIndexLineGivesWayToTheLiveOneWhileDownloading() throws Exception {
        LiveDownload l = live(0, 2, 12_400_000, 40_100_000, 1_200_000, DownloadProgress.Phase.MOVING);
        JSONObject dl = new JSONObject().put("state", KeptIndex.DOWNLOADING).put("total", 2).put("done", 0).put("bytes", 100);
        assertEquals("Track 1 of 2 · 12.4 of 40.1 MB · 1.2 MB/s", KeptIndex.describe(dl, l));
        JSONObject up = new JSONObject().put("state", KeptIndex.UPDATING).put("total", 3).put("done", 2);
        assertEquals("Updating · Track 1 of 2 · 12.4 of 40.1 MB · 1.2 MB/s", KeptIndex.describe(up, l));
        dl.put("auto", true);
        assertEquals("Track 1 of 2 · 12.4 of 40.1 MB · 1.2 MB/s · Kept automatically", KeptIndex.describe(dl, l));
    }

    @Test public void otherStatesAndNoLiveKeepTheIndexLine() throws Exception {
        LiveDownload l = live(0, 2, 1, 2, 0, DownloadProgress.Phase.MOVING);
        JSONObject ready = new JSONObject().put("state", KeptIndex.READY).put("bytes", 5_000_000);
        assertEquals(KeptIndex.describe(ready), KeptIndex.describe(ready, l));
        JSONObject dl = new JSONObject().put("state", KeptIndex.DOWNLOADING).put("total", 2).put("done", 1);
        assertEquals(KeptIndex.describe(dl), KeptIndex.describe(dl, null));
    }

    @Test public void theRegistryHoldsWhatWasPublishedAndTellsListeners() {
        LiveDownloads.clear();
        final int[] heard = { 0 };
        Runnable r = () -> heard[0]++;
        LiveDownloads.listen(r);
        LiveDownload l = live(0, 1, 5, 10, 0, DownloadProgress.Phase.MOVING);
        LiveDownloads.publish(java.util.Collections.singletonMap("plex:1", l));
        assertEquals(1, heard[0]);
        assertEquals(l, LiveDownloads.get("plex:1"));
        assertNull(LiveDownloads.get("plex:2"));
        LiveDownloads.unlisten(r);
        LiveDownloads.publish(java.util.Collections.<String, LiveDownload>emptyMap());
        assertEquals("unsubscribed", 1, heard[0]);
        assertNull(LiveDownloads.get("plex:1"));
    }
}
