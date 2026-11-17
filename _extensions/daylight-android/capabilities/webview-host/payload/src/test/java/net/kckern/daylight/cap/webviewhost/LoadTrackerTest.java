package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.webviewhost.LoadTracker.Result;
import net.kckern.daylight.cap.webviewhost.LoadTracker.State;

import org.junit.Test;

import java.util.concurrent.CompletableFuture;

public class LoadTrackerTest {
    /** onPageStarted then onPageFinished for the load in progress, as the WebView reports a plain load. */
    private static Result fin(LoadTracker t, long nowMs) {
        String url = t.loadingUrl();
        if (url != null) t.started(url);
        return t.finished(nowMs, url);
    }

    @Test public void aLoadThatFinishesCleanlyIsLoaded() throws Exception {
        LoadTracker t = new LoadTracker();
        long gen = t.begin("https://a.test/", 1_000);
        CompletableFuture<Result> waiter = t.waiter(gen);
        assertEquals(State.LOADING, t.state());
        Result r = fin(t, 1_800);
        assertTrue(r.ok);
        assertEquals(800, r.loadTimeMs);
        assertEquals(1_800, r.atMs);
        assertEquals(State.LOADED, t.state());
        assertSame(r, waiter.get());
        assertEquals(0, t.failures());
        assertTrue(t.last().toJson().getBoolean("ok"));
    }

    @Test public void aMainFrameErrorWinsOverTheFinishThatFollowsIt() {
        // WebView reports onReceivedError and then onPageFinished for its own error page.
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.mainFrameError("-2 net::ERR_NAME_NOT_RESOLVED");
        Result r = fin(t, 500);
        assertFalse(r.ok);
        assertEquals("-2 net::ERR_NAME_NOT_RESOLVED", r.error);
        assertEquals(State.FAILED, t.state());
        assertEquals(1, t.failures());
    }

    @Test public void aSecondFinishOrAnErrorOutsideALoadChangesNothing() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        assertNotNull(fin(t, 100));
        assertNull("onPageFinished can fire again; it must not produce a second result", fin(t, 200));
        t.mainFrameError("late");
        assertEquals(State.LOADED, t.state());
    }

    @Test public void aDeadlineFailsOnlyTheLoadItBelongsTo() {
        LoadTracker t = new LoadTracker();
        long first = t.begin("https://a.test/", 0);
        long second = t.begin("https://b.test/", 10);
        assertNull("a stale deadline is ignored", t.timeout(first, 20_000));
        Result r = t.timeout(second, 20_010);
        assertFalse(r.ok);
        assertEquals("timeout", r.error);
        assertEquals("https://b.test/", r.url);
    }

    @Test public void aNewLoadSupersedesTheOldOneWithoutCountingAFailure() throws Exception {
        LoadTracker t = new LoadTracker();
        long first = t.begin("https://a.test/", 0);
        CompletableFuture<Result> old = t.waiter(first);
        t.begin("https://b.test/", 10);
        assertEquals("superseded", old.get().error);
        assertEquals(0, t.failures());
    }

    @Test public void failuresAccumulateAndASuccessResetsThem() {
        LoadTracker t = new LoadTracker();
        for (int i = 0; i < 3; i++) { t.begin("https://a.test/", i); t.mainFrameError("x"); fin(t, i); }
        assertEquals(3, t.failures());
        t.begin("https://a.test/", 9);
        fin(t, 10);
        assertEquals(0, t.failures());
    }

    @Test public void aRendererLossFailsTheLoadInProgress() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        assertEquals("renderer gone", t.rendererGone(5).error);
        assertNull(new LoadTracker().rendererGone(5));
    }

    @Test public void nextCompletesOnWhateverSettlesNext() throws Exception {
        LoadTracker t = new LoadTracker();
        CompletableFuture<Result> next = t.next();
        t.begin("https://a.test/", 0);
        assertFalse(next.isDone());
        fin(t, 1);
        assertTrue(next.get().ok);
    }

    @Test public void aWaiterForAFinishedGenerationGetsTheLastResult() throws Exception {
        LoadTracker t = new LoadTracker();
        long gen = t.begin("https://a.test/", 0);
        fin(t, 1);
        assertTrue(t.waiter(gen).get().ok);
    }

    @Test public void anAcceptedLoadIsVisibleAsLoadingUntilItSettles() {
        // The wait:false mode: the route answers at once and the caller polls lastLoad.
        LoadTracker t = new LoadTracker();
        t.begin("https://old.test/", 0);
        Result old = fin(t, 100);
        t.begin("https://new.test/", 5_000);
        assertEquals(State.LOADING, t.state());
        assertEquals("https://new.test/", t.loadingUrl());
        assertSame("lastLoad is still the previous page until the new one settles", old, t.last());
        Result settled = fin(t, 5_700);
        assertNull(t.loadingUrl());
        assertSame(settled, t.last());
        assertEquals("https://new.test/", t.last().url);
        assertTrue("a later atMs tells the poller this is the load it asked for", t.last().atMs > old.atMs);
    }

    @Test public void anAcceptedLoadThatFailsIsReportedInLastLoad() throws Exception {
        LoadTracker t = new LoadTracker();
        t.begin("https://new.test/", 5_000);
        t.mainFrameError("-6 net::ERR_CONNECTION_REFUSED");
        fin(t, 5_050);
        assertFalse(t.last().ok);
        assertEquals("-6 net::ERR_CONNECTION_REFUSED", t.last().toJson().getString("error"));
        assertNull(t.loadingUrl());
    }

    @Test public void redirectsUpdateTheReportedUrl() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.redirected("https://a.test/login");
        assertEquals("https://a.test/login", fin(t, 1).url);
    }

    // ── load ids (the contract: every load has one, and lastLoad carries it) ──

    @Test public void everyLoadHasItsOwnIdCarriedInItsResult() throws Exception {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        String first = t.loadingId();
        Result a = fin(t, 1);
        t.begin("https://a.test/", 2);
        String second = t.loadingId();
        Result b = fin(t, 3);
        assertNotNull(first);
        assertFalse("a reload of the same URL is a different load", first.equals(second));
        assertEquals(first, a.loadId);
        assertEquals(second, b.loadId);
        assertEquals(second, t.last().toJson().getString("loadId"));
        assertNull(t.loadingId());
    }

    @Test public void twoTrackersNeverHandOutTheSameId() {
        // A payload restart makes a new tracker; a poller holding an old id must not match a new load.
        assertFalse(new LoadTracker().newLoadId().equals(new LoadTracker().newLoadId()));
    }

    @Test public void aLoadBegunWithAReservedIdReportsThatId() {
        // wait:false answers with the id before the load starts on the main thread.
        LoadTracker t = new LoadTracker();
        String id = t.newLoadId();
        t.begin("https://a.test/", 0, id);
        assertEquals(id, t.loadingId());
        assertEquals(id, fin(t, 1).loadId);
    }

    @Test public void aSupersededLoadKeepsItsOwnIdInItsResult() throws Exception {
        LoadTracker t = new LoadTracker();
        long first = t.begin("https://a.test/", 0);
        String firstId = t.loadingId();
        CompletableFuture<Result> old = t.waiter(first);
        t.begin("https://b.test/", 10);
        assertEquals(firstId, old.get().loadId);
    }

    @Test public void anAcceptedLoadThatCannotStartIsStillReportedUnderItsId() {
        // The Activity went away between the acknowledgement and the main thread: the poller must not wait forever.
        LoadTracker t = new LoadTracker();
        t.begin("https://old.test/", 0);
        fin(t, 1);
        String id = t.newLoadId();
        Result r = t.refused("https://new.test/", id, "no_kiosk_activity", 50);
        assertFalse(r.ok);
        assertEquals(id, t.last().loadId);
        assertEquals("no_kiosk_activity", t.last().error);
        assertEquals("a refusal is not a failed page: the old page is still showing", State.LOADED, t.state());
        assertEquals(0, t.failures());
    }

    // ── a finish counts only for the load whose start was seen ───────────────

    @Test public void aStaleFinishOfTheSupersededLoadDoesNotSettleTheNextOne() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        long b = t.begin("https://b.test/", 10);            // B asked for while A is still loading
        // The WebView stops A and reports its finish. B has not started yet.
        assertNull("A's finish is not B's", t.finished(20, "https://a.test/"));
        assertEquals(LoadTracker.State.LOADING, t.state());
        assertFalse(t.waiter(b).isDone());

        t.started("https://b.test/");
        Result r = t.finished(900, "https://b.test/");
        assertNotNull(r);
        assertTrue(r.ok);
        assertEquals("https://b.test/", r.url);
        assertEquals(890, r.loadTimeMs);
    }

    @Test public void aStaleFinishThatArrivesAfterTheNextStartIsStillNotCounted() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        t.begin("https://b.test/", 10);
        t.started("https://b.test/");                       // B's start is seen first this time
        assertNull("it names the superseded load's URL", t.finished(20, "https://a.test/"));
        assertNotNull(t.finished(900, "https://b.test/"));
    }

    @Test public void aFinishWithNoStartSeenIsIgnored() {
        LoadTracker t = new LoadTracker();
        long gen = t.begin("https://a.test/", 0);
        assertNull(t.finished(5, "https://a.test/"));
        assertNull(t.finished(6, null));
        assertEquals(LoadTracker.State.LOADING, t.state());
        // The deadline still ends such a load.
        assertEquals("timeout", t.timeout(gen, 20_000).error);
    }

    @Test public void aRedirectChainSettlesOnTheFinalUrl() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        t.started("https://a.test/login");                  // each hop reports a start
        t.started("https://sso.test/auth");
        Result r = t.finished(700, "https://sso.test/auth");
        assertTrue(r.ok);
        assertEquals("https://sso.test/auth", r.url);
    }

    @Test public void aServerRedirectThatReportsOnlyTheFirstStartStillSettles() {
        // onPageStarted for the original URL, onPageFinished for where the server sent it.
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        Result r = t.finished(300, "https://a.test/home");
        assertTrue(r.ok);
        assertEquals("the result carries the URL the page ended on", "https://a.test/home", r.url);
    }

    @Test public void reloadingTheSameUrlTwiceIsNotMistakenForAStaleFinish() {
        LoadTracker t = new LoadTracker();
        t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        t.begin("https://a.test/", 10);                     // the same address again
        assertNull("no start seen for the second load yet", t.finished(20, "https://a.test/"));
        t.started("https://a.test/");
        assertNotNull(t.finished(500, "https://a.test/"));
    }

    @Test public void aLoadTheKioskStoppedItselfSettlesAsAFailureThatIsRetried() {
        LoadTracker t = new LoadTracker();
        long gen = t.begin("https://a.test/", 0);
        t.started("https://a.test/");
        Result r = t.stopped("this page leads to https://sso.test, which is not in webview.allowedOrigins", 40);
        assertFalse(r.ok);
        assertEquals(LoadTracker.State.FAILED, t.state());
        assertEquals("it counts, so the retry delay grows", 1, t.failures());
        assertTrue(t.waiter(gen).isDone());
        assertNull("nothing is in progress any more", t.stopped("again", 50));
        assertNull(t.finished(60, "https://a.test/"));
    }
}
