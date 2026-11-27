package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AboutTest {
    private static JSONObject track(String id, String album, String albumTitle, long sec) throws Exception {
        return new JSONObject().put("id", id).put("albumId", album).put("album", albumTitle).put("duration", sec);
    }

    @Test public void anAuthorsHeaderSaysWhoAndHowMuch() throws Exception {
        JSONObject info = new JSONObject().put("id", "plex:100").put("thumbnail", "")
                .put("metadata", new JSONObject().put("summary", "  An author.  ")
                        .put("countries", new JSONArray().put("United Kingdom")).put("genres", new JSONArray()));
        JSONObject leaves = new JSONObject().put("items", new JSONArray()
                .put(track("plex:11", "10", "Book one", 3600)).put(track("plex:12", "10", "Book one", 1800))
                .put(track("plex:21", "20", "Book two", 7200)));
        JSONObject recent = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("contentId", "plex:12").put("playhead", 600))
                .put(new JSONObject().put("contentId", "plex:11").put("playhead", 3600).put("finished", true)));
        JSONObject a = About.of(info, leaves, recent, null);
        assertEquals("An author.", a.getString("summary"));
        assertEquals("United Kingdom", a.getJSONArray("countries").getString(0));
        assertEquals(2, a.getInt("children"));
        assertEquals(12600, a.getLong("totalSec"));
        JSONObject one = a.getJSONObject("books").getJSONObject("plex:10");
        assertEquals(5400, one.getLong("seconds"));
        assertEquals(4200, one.getLong("playedSec"));
        assertTrue(one.getBoolean("started"));
        assertFalse(one.getBoolean("finished"));
        assertFalse(a.getJSONObject("books").getJSONObject("plex:20").getBoolean("started"));
        // "Continue Book one": started, not finished, played last.
        assertEquals("plex:10", a.getJSONObject("continue").getString("id"));
        assertEquals("plex:12", a.getJSONObject("continue").getString("partId"));
        assertEquals("Book one", a.getJSONObject("continue").getString("title"));
    }

    @Test public void nothingStartedMeansNoContinue() throws Exception {
        JSONObject a = About.of(new JSONObject().put("id", "plex:1"), new JSONObject().put("items", new JSONArray()
                .put(track("plex:2", "3", "B", 100))), new JSONObject(), null);
        assertFalse(a.has("continue"));
        assertFalse(a.getJSONObject("books").getJSONObject("plex:3").getBoolean("started"));
    }

    /** A book opened by a link: its title and author come with the header. */
    @Test public void aBookHeaderNamesTheBookAndItsAuthor() throws Exception {
        JSONObject info = new JSONObject().put("id", "plex:728064").put("title", "Richard III")
                .put("metadata", new JSONObject().put("parentTitle", "William Shakespeare"));
        JSONObject a = About.of(info, null, null, null);
        assertEquals("Richard III", a.getString("title"));
        assertEquals("William Shakespeare", a.getString("byline"));
    }

    @Test public void anAlbumsHeaderHasItsArtistAndYear() throws Exception {
        JSONObject info = new JSONObject().put("id", "plex:80244").put("title", "Snakes & Arrows")
                .put("metadata", new JSONObject().put("year", 2007).put("parentTitle", "Rush")
                        .put("parentType", "artist").put("parentRatingKey", "80086"));
        JSONObject a = About.of(info, null, null, null);
        assertEquals("Rush", a.getString("byline"));
        assertEquals(2007, a.getInt("year"));
        assertEquals("plex:80086", a.getString("bylineId"));
        JSONObject noYear = About.of(new JSONObject().put("id", "plex:1").put("metadata", new JSONObject()), null, null, null);
        assertFalse(noYear.has("year"));
        assertFalse(noYear.has("bylineId"));
    }
}
