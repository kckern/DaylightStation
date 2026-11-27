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
}
