package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** A level's rows are named by what they are, so only one collection is offered Play and Keep. */
public class BrowseKindTest {
    @Test public void kindsGoDownTheTree() {
        assertEquals("author", BrowseActivity.childKind("library-books", "c:plex:727118"));
        assertEquals("book", BrowseActivity.childKind("author", "c:plex:727119"));
        assertEquals("artist", BrowseActivity.childKind("library", "c:plex:1"));
        assertEquals("album", BrowseActivity.childKind("artist", "c:plex:2"));
        assertEquals("lists", BrowseActivity.childKind("library", "s:0|plex:playlists"));
        assertEquals("playlist", BrowseActivity.childKind("lists", "c:plex:758161"));
    }

    @Test public void letterSkipsTheAndA() {
        assertEquals('B', BrowseActivity.letterOf("The Beatles"));
        assertEquals('T', BrowseActivity.letterOf("Thomas More"));
        assertEquals('M', BrowseActivity.letterOf("a Midsummer Night"));
        assertEquals('#', BrowseActivity.letterOf("1984"));
    }

    @Test public void aBooksProgressInWords() throws Exception {
        java.util.List<String> ids = java.util.Arrays.asList("plex:1", "plex:2");
        org.json.JSONObject p = new org.json.JSONObject()
                .put("plex:1", new org.json.JSONObject().put("playhead", 3600).put("duration", 3600).put("finished", true))
                .put("plex:2", new org.json.JSONObject().put("playhead", 600).put("duration", 7200));
        assertEquals("1 h 50 min left · 39 %", BrowseActivity.progressWords(ids, p));
        assertEquals("Not started", BrowseActivity.progressWords(ids, new org.json.JSONObject()));
        assertEquals("Finished", BrowseActivity.progressWords(java.util.Arrays.asList("plex:1"), p));
        assertEquals("Progress isn't available offline", BrowseActivity.progressWords(ids, null));
    }

    @Test public void contentIdsComeOutOfMediaIds() {
        assertEquals("plex:731396", BrowseActivity.contentIdOf("c:plex:731396"));
        assertEquals("plex:5", BrowseActivity.contentIdOf("p:plex:5|plex:9"));
        assertEquals("plex:5", BrowseActivity.contentIdOf("plex:5"));
    }
}
