package net.kckern.daylight.cap.webviewhost;

import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;

/**
 * What happened to the main-frame load. Pure Java; the WebViewClient feeds it.
 *
 * WebView facts it encodes: a failed load reports onReceivedError and THEN onPageFinished
 * (for its own error page), and onPageFinished can fire more than once. So an error
 * recorded during a load decides the result, and only the first finish settles it.
 *
 * Every load has an id, an opaque string. A caller that asked for a load matches its
 * result by that id, so an earlier load of the same URL cannot pass for it.
 */
final class LoadTracker {
    enum State { IDLE, LOADING, LOADED, FAILED }

    static final class Result {
        final String loadId;
        final String url;
        final boolean ok;
        final String error;
        final long atMs;
        final long loadTimeMs;

        Result(String loadId, String url, boolean ok, String error, long atMs, long loadTimeMs) {
            this.loadId = loadId;
            this.url = url;
            this.ok = ok;
            this.error = error;
            this.atMs = atMs;
            this.loadTimeMs = loadTimeMs;
        }

        JSONObject toJson() {
            try {
                return new JSONObject().put("loadId", loadId == null ? JSONObject.NULL : loadId)
                        .put("url", url == null ? JSONObject.NULL : url).put("ok", ok)
                        .put("error", error == null ? JSONObject.NULL : error).put("atMs", atMs);
            } catch (Exception e) { throw new IllegalStateException(e); }
        }
    }

    /** Different for every tracker, so an id from before a payload restart never matches a load after it. */
    private final String idPrefix = randomHex();
    private final AtomicLong idCounter = new AtomicLong();

    private State state = State.IDLE;
    private long generation;
    private long startedAt;
    private String url;
    private String loadId;
    private String pendingError;
    /** onPageStarted was seen for the current generation. Only then can a finish be its finish. */
    private boolean startSeen;
    /** The URL of the load the current one superseded, whose finish may still arrive. */
    private String supersededUrl;
    private int failures;
    private Result last;
    private final Map<Long, CompletableFuture<Result>> waiters = new HashMap<>();
    private final List<CompletableFuture<Result>> nextWaiters = new ArrayList<>();

    private static String randomHex() {
        byte[] b = new byte[4];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    /** Reserve an id for a load that will begin shortly. Safe from any thread. */
    String newLoadId() { return idPrefix + "-" + idCounter.incrementAndGet(); }

    synchronized State state() { return state; }
    synchronized Result last() { return last; }
    /** The URL of the load in progress, or null. With wait:false this is how a poller sees "not settled yet". */
    synchronized String loadingUrl() { return state == State.LOADING ? url : null; }
    /** The id of the load in progress, or null. */
    synchronized String loadingId() { return state == State.LOADING ? loadId : null; }
    synchronized int failures() { return failures; }

    /** A main-frame load starts. Returns its generation. A load already in progress is superseded. */
    synchronized long begin(String url, long nowMs) { return begin(url, nowMs, newLoadId()); }

    /** As begin, for a load whose id was reserved with newLoadId(). */
    synchronized long begin(String url, long nowMs, String id) {
        supersededUrl = null;
        if (state == State.LOADING) {
            supersededUrl = this.url;
            settle(new Result(loadId, this.url, false, "superseded", nowMs, nowMs - startedAt), false);
        }
        startSeen = false;
        generation++;
        state = State.LOADING;
        this.url = url;
        loadId = id;
        startedAt = nowMs;
        pendingError = null;
        return generation;
    }

    /** Completes when the given load settles. Already complete if it has. */
    synchronized CompletableFuture<Result> waiter(long gen) {
        if (gen == generation && state == State.LOADING) {
            return waiters.computeIfAbsent(gen, g -> new CompletableFuture<>());
        }
        CompletableFuture<Result> done = new CompletableFuture<>();
        done.complete(last != null ? last : new Result(null, url, false, "no load in progress", 0, 0));
        return done;
    }

    /** Completes on the next result of any load. */
    synchronized CompletableFuture<Result> next() {
        CompletableFuture<Result> f = new CompletableFuture<>();
        nextWaiters.add(f);
        return f;
    }

    /**
     * onPageStarted for the load in progress: its start is now seen, and the URL is the
     * one the WebView is on (a redirect chain reports each hop here).
     */
    synchronized void started(String url) {
        if (state != State.LOADING) return;
        startSeen = true;
        this.url = url;
    }

    /** Kept for callers that only mean "the URL changed"; it counts as a start. */
    synchronized void redirected(String url) { started(url); }

    synchronized void mainFrameError(String error) {
        if (state == State.LOADING && pendingError == null) pendingError = error;
    }

    /**
     * onPageFinished. Null when no load was in progress, or when this finish belongs to
     * a load that was superseded: a finish counts only for the generation whose
     * onPageStarted has been seen. Starting load B while A is still loading makes the
     * WebView report A's finish, and that used to settle B as loaded.
     *
     * @param finishedUrl the URL the WebView reports. A server redirect can make it
     *                    differ from the started URL, so it is not required to match;
     *                    it is used only to recognise the superseded load's finish.
     */
    synchronized Result finished(long nowMs, String finishedUrl) {
        if (state != State.LOADING || !startSeen) return null;
        if (finishedUrl != null && finishedUrl.equals(supersededUrl) && !finishedUrl.equals(url)) return null;
        if (finishedUrl != null) url = finishedUrl;
        return settle(new Result(loadId, url, pendingError == null, pendingError, nowMs, nowMs - startedAt), true);
    }

    /** The deadline for one generation passed. Null when that load already settled or was superseded. */
    synchronized Result timeout(long gen, long nowMs) {
        if (state != State.LOADING || gen != generation) return null;
        return settle(new Result(loadId, url, false, "timeout", nowMs, nowMs - startedAt), true);
    }

    /** The renderer died. Null when no load was in progress. */
    synchronized Result rendererGone(long nowMs) {
        if (state != State.LOADING) return null;
        return settle(new Result(loadId, url, false, "renderer gone", nowMs, nowMs - startedAt), true);
    }

    /**
     * An acknowledged load could not start at all. It becomes the last result, so the
     * caller polling for its id gets an answer; the page that is showing is untouched,
     * so the state and the failure count stay as they were.
     */
    synchronized Result refused(String url, String id, String error, long nowMs) {
        Result r = new Result(id, url, false, error, nowMs, 0);
        last = r;
        return r;
    }

    private Result settle(Result r, boolean countFailure) {
        state = r.ok ? State.LOADED : State.FAILED;
        if (r.ok) failures = 0; else if (countFailure) failures++;
        last = r;
        CompletableFuture<Result> w = waiters.remove(generation);
        if (w != null) w.complete(r);
        for (CompletableFuture<Result> f : nextWaiters) f.complete(r);
        nextWaiters.clear();
        return r;
    }
}
