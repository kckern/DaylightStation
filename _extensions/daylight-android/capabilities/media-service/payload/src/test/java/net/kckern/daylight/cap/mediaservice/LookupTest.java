package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;

public class LookupTest {
    private static JSONObject item(String id, String itemType, String type, String library, String title) throws Exception {
        JSONObject meta = new JSONObject().put("type", type).put("librarySectionTitle", library);
        return new JSONObject().put("id", id).put("itemType", itemType).put("metadata", meta).put("title", title);
    }

    /** Books are albums in a book library; video containers never show; tracks need a stream. */
    @Test public void searchResultsAreGroupedAndAudioOnly() throws Exception {
        JSONArray items = new JSONArray()
                .put(item("plex:1", "container", "album", "Audiobooks", "Consolations"))
                .put(item("plex:2", "container", "album", "Music", "Abbey Road"))
                .put(item("plex:3", "container", "artist", "Audiobooks", "David Whyte"))
                .put(item("plex:4", "container", "show", "TV Shows", "A show"))
                .put(item("plex:5", "leaf", "track", "Music", "Come Together").put("mediaType", "audio").put("mediaUrl", "/x"))
                .put(item("plex:6", "leaf", "movie", "Movies", "A film").put("mediaType", "video").put("mediaUrl", "/y"));
        JSONObject out = Lookup.groups(new JSONObject().put("items", items), null, 5);
        JSONArray groups = out.getJSONArray("groups");
        assertEquals(4, groups.length());
        assertEquals("books", groups.getJSONObject(0).getString("key"));
        assertEquals("c:plex:1", groups.getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("albums", groups.getJSONObject(1).getString("key"));
        assertEquals("artists", groups.getJSONObject(2).getString("key"));
        assertEquals("tracks", groups.getJSONObject(3).getString("key"));
        assertEquals("p:plex:5", groups.getJSONObject(3).getJSONArray("items").getJSONObject(0).getString("id"));
        assertFalse(out.toString().contains("plex:4"));
        assertFalse(out.toString().contains("plex:6"));
    }

    @Test public void aGroupStopsAtItsLimitAndCountsTheRest() throws Exception {
        JSONArray items = new JSONArray();
        for (int i = 0; i < 8; i++) items.put(item("plex:" + i, "container", "album", "Music", "A" + i));
        JSONObject g = Lookup.groups(new JSONObject().put("items", items), null, 5).getJSONArray("groups").getJSONObject(0);
        assertEquals(5, g.getJSONArray("items").length());
        assertEquals(3, g.getInt("more"));
    }

    @Test public void theLibraryIsTheAudioLibrariesThenTheListSources() throws Exception {
        JSONObject plex = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("id", "plex:library/sections/6/all").put("title", "Movies").put("type", "movie"))
                .put(new JSONObject().put("id", "plex:library/sections/9/all").put("title", "Audiobooks").put("type", "artist"))
                .put(new JSONObject().put("id", "plex:library/sections/5/all").put("title", "Music").put("type", "artist")));
        JSONObject sources = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("id", "plex:playlists").put("title", "Plex")));
        JSONArray root = Lookup.libraryRoot(plex, sources);
        assertEquals(3, root.length());
        assertEquals("Audiobooks", root.getJSONObject(0).getString("title"));
        assertEquals("library-books", root.getJSONObject(0).getString("kind"));
        assertEquals("c:plex:library/sections/9/all", root.getJSONObject(0).getString("id"));
        assertEquals("library", root.getJSONObject(1).getString("kind"));
        assertEquals("Playlists", root.getJSONObject(2).getString("title"));
    }

    /** Offline, search answers from what is kept: every word must be in the title. */
    @Test public void offlineSearchFindsKeptCollectionsByEveryWord() throws Exception {
        JSONObject out = Lookup.offline(Arrays.asList(
                new JSONObject().put("contentId", "plex:1").put("title", "The Consolation of Philosophy"),
                new JSONObject().put("contentId", "plex:2").put("title", "Abbey Road")), "consolation philosophy");
        assertTrue(out.getBoolean("offline"));
        JSONArray hits = out.getJSONArray("groups").getJSONObject(0).getJSONArray("items");
        assertEquals(1, hits.length());
        assertEquals("c:plex:1", hits.getJSONObject(0).getString("id"));
        assertEquals(0, Lookup.offline(Arrays.asList(new JSONObject().put("contentId", "plex:2").put("title", "Abbey Road")), "zz").getJSONArray("groups").length());
    }

    /** "Boethius" finds the author; their books lead the Books group. */
    @Test public void anAuthorsBooksLeadTheBooksGroup() throws Exception {
        JSONObject search = new JSONObject().put("items", new JSONArray()
                .put(item("plex:727118", "container", "artist", "Audiobooks", "Boethius"))
                .put(item("plex:9", "container", "artist", "Music", "A band")));
        java.util.List<String[]> authors = Lookup.authors(search, 2);
        assertEquals(1, authors.size());
        assertEquals("plex:727118", authors.get(0)[0]);
        JSONObject body = Lookup.groups(search, null, 5);
        JSONObject children = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("id", "plex:727119").put("title", "The Consolation of Philosophy").put("itemType", "container"))
                .put(new JSONObject().put("id", "plex:5").put("title", "A track").put("itemType", "leaf")));
        Lookup.prependBooks(body, Lookup.booksOf(children, "Boethius", null, 8));
        JSONObject first = body.getJSONArray("groups").getJSONObject(0);
        assertEquals("books", first.getString("key"));
        assertEquals(1, first.getJSONArray("items").length());
        assertEquals("c:plex:727119", first.getJSONArray("items").getJSONObject(0).getString("id"));
        assertEquals("Boethius", first.getJSONArray("items").getJSONObject(0).getString("subtitle"));
    }

    /** Now playing's lines open pages: a track's album and artist from its info. */
    @Test public void aTracksParentsComeFromItsInfo() throws Exception {
        JSONObject info = new JSONObject().put("contentId", "plex:731397").put("metadata", new JSONObject()
                .put("albumId", "731396").put("artistId", "731395").put("album", "Consolations").put("artist", "David Whyte")
                .put("librarySectionTitle", "Audiobooks"));
        JSONObject p = Lookup.parents(info);
        assertEquals("c:plex:731396", p.getJSONObject("album").getString("id"));
        assertEquals("book", p.getJSONObject("album").getString("kind"));
        assertEquals("c:plex:731395", p.getJSONObject("artist").getString("id"));
        assertEquals("author", p.getJSONObject("artist").getString("kind"));
        assertEquals(0, Lookup.parents(new JSONObject()).length());
    }

    @Test public void progressComesFromTheRecentList() throws Exception {
        JSONObject recent = new JSONObject().put("items", new JSONArray()
                .put(new JSONObject().put("contentId", "plex:1").put("playhead", 600).put("duration", 3600))
                .put(new JSONObject().put("contentId", "plex:1").put("playhead", 10).put("duration", 3600))
                .put(new JSONObject().put("contentId", "plex:2").put("playhead", 5).put("duration", 60)));
        JSONObject p = Lookup.progress(recent, new java.util.HashSet<>(Arrays.asList("plex:1")));
        assertEquals(1, p.length());
        assertEquals(600, p.getJSONObject("plex:1").getLong("playhead"));
    }
}
