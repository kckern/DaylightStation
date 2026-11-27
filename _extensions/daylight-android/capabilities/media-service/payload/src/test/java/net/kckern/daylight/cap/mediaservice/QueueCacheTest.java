package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class QueueCacheTest {
    /** Home's queue answers, counted; each call answers the next version. */
    static final class Home implements MediaApi {
        int calls;
        long itemSeconds = 200;
        long resumeSeconds = 0;
        JSONObject answer(String id) throws Exception {
            calls++;
            JSONObject item = new JSONObject().put("id", id + ":t" + calls).put("duration", itemSeconds);
            if (resumeSeconds > 0) item.put("resume_position", resumeSeconds);
            return new JSONObject().put("items", new JSONArray().put(item)).put("version", calls);
        }
        @Override public JSONObject queue(String contentId) throws Exception { return answer(contentId); }
        @Override public JSONObject queue(String contentId, boolean shuffle) throws Exception { return answer(contentId + (shuffle ? "~s" : "")); }
        @Override public JSONObject rootList() { return null; }
        @Override public JSONObject list(String c, int t, int s) { return null; }
        @Override public JSONObject recent(int l) { return null; }
        @Override public JSONObject audioSources() { return null; }
        @Override public JSONObject audioLists(String s, int c) { return null; }
        @Override public JSONObject play(String c, boolean r) { return null; }
        @Override public JSONObject search(String t, int n) { return null; }
        @Override public JSONObject log(JSONObject b) { return null; }
    }

    private final List<Runnable> later = new ArrayList<>();
    private long now = 1_700_000_000_000L;

    private QueueCache cache(Home home) throws Exception {
        File dir = Files.createTempDirectory("queue-cache").toFile();
        return new QueueCache(home, dir, later::add, () -> now);
    }

    private void runLater() { List<Runnable> r = new ArrayList<>(later); later.clear(); r.forEach(Runnable::run); }

    @Test public void aSecondTapPlaysTheLastAnswerAtOnceAndFetchesTheNextInTheBackground() throws Exception {
        Home home = new Home();
        QueueCache c = cache(home);
        assertEquals(1, c.queue("plex:1", false).getInt("version"));
        assertEquals("miss", c.last);
        assertEquals(1, c.queue("plex:1", false).getInt("version"));   // no wait on home
        assertEquals("hit", c.last);
        assertEquals(1, home.calls);
        assertEquals(1, later.size());
        runLater();
        assertEquals(2, home.calls);
        assertEquals(2, c.queue("plex:1", false).getInt("version"));   // the refreshed answer
    }

    @Test public void oneRefreshAtATimePerList() throws Exception {
        Home home = new Home();
        QueueCache c = cache(home);
        c.queue("plex:1", false);
        c.queue("plex:1", false);
        c.queue("plex:1", false);
        assertEquals(1, later.size());
    }

    @Test public void booksAndPlacesAreNeverCached() throws Exception {
        Home home = new Home();
        home.itemSeconds = 45 * 60;
        QueueCache c = cache(home);
        c.queue("plex:book", false);
        assertEquals("pass", c.last);
        c.queue("plex:book", false);
        assertEquals(2, home.calls);

        Home placed = new Home();
        placed.resumeSeconds = 30;
        QueueCache p = cache(placed);
        p.queue("plex:album", false);
        p.queue("plex:album", false);
        assertEquals(2, placed.calls);
    }

    @Test public void shuffledAndInOrderAreKeptApart() throws Exception {
        Home home = new Home();
        QueueCache c = cache(home);
        JSONObject inOrder = c.queue("plex:1", false);
        JSONObject shuffled = c.queue("plex:1", true);
        assertEquals("miss", c.last);
        assertNotEquals(inOrder.getJSONArray("items").getJSONObject(0).getString("id"),
                shuffled.getJSONArray("items").getJSONObject(0).getString("id"));
    }

    @Test public void anOldAnswerIsNotPlayedWithoutAskingHome() throws Exception {
        Home home = new Home();
        QueueCache c = cache(home);
        c.queue("plex:1", false);
        now += QueueCache.MAX_AGE_MS + 1;
        assertEquals(2, c.queue("plex:1", false).getInt("version"));
        assertEquals("miss", c.last);
    }

    @Test public void aListThatBecameABookIsForgottenOnRefresh() throws Exception {
        Home home = new Home();
        QueueCache c = cache(home);
        c.queue("plex:1", false);
        c.queue("plex:1", false);
        home.itemSeconds = 3600;
        runLater();
        c.queue("plex:1", false);
        assertEquals("pass", c.last);
    }
}
