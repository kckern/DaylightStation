package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

import net.kckern.daylight.cap.mediaservice.shell.MediaKind.Action;
import net.kckern.daylight.cap.mediaservice.shell.MediaKind.RowAction;

public class MediaKindTest {
    /** The owner's report: an audiobook author with Play and Shuffle. An author page is about the author. */
    @Test public void anAuthorPageHasNoPlayOrShuffle() {
        MediaKind.ActionSet none = MediaKind.actions("author", false);
        assertNull(none.primary);
        assertTrue(none.secondary.isEmpty());
        assertTrue(none.overflow.isEmpty());
        MediaKind.ActionSet started = MediaKind.actions("author", true);
        assertEquals(Action.CONTINUE, started.primary);
        for (Action a : Action.values()) if (a != Action.CONTINUE) assertFalse(a + " on an author", started.has(a));
    }

    @Test public void aBookHasOnePrimaryAndSpokenWordIcons() {
        MediaKind.ActionSet book = MediaKind.actions("book", true);
        assertEquals(Action.RESUME, book.primary);
        assertEquals(Arrays.asList(Action.PLAY_ON, Action.KEEP, Action.SPEED, Action.CHAPTERS), book.secondary);
        assertEquals(Arrays.asList(Action.PLAY_FROM_START, Action.MARK_FINISHED), book.overflow);
        assertFalse(book.has(Action.SHUFFLE));
        assertFalse(book.has(Action.ADD_TO_PLAYLISTS));   // Your playlists is music only
    }

    @Test public void musicCollectionsShuffleAndCanJoinYourPlaylists() {
        for (String k : new String[] { "album", "playlist", "albums", "playlists" }) {
            MediaKind.ActionSet s = MediaKind.actions(k, false);
            assertEquals(Action.PLAY, s.primary);
            assertEquals(Arrays.asList(Action.SHUFFLE, Action.PLAY_ON, Action.KEEP), s.secondary);
            assertEquals(Collections.singletonList(Action.ADD_TO_PLAYLISTS), s.overflow);
        }
    }

    @Test public void aStationPlaysWholeWithoutShuffleOrRows() {
        MediaKind.ActionSet s = MediaKind.actions("station", false);
        assertEquals(Action.PLAY, s.primary);
        assertFalse(s.has(Action.SHUFFLE));
        assertFalse(MediaKind.listsRows("station"));
        assertEquals(MediaKind.Tap.NONE, MediaKind.rowTap("station", false, true));
        assertTrue(MediaKind.rowMenu("station").isEmpty());
    }

    @Test public void aMusicArtistOnlyShuffles() {
        MediaKind.ActionSet s = MediaKind.actions("artist", false);
        assertEquals(Action.SHUFFLE_ARTIST, s.primary);
        assertTrue(s.secondary.isEmpty());
        assertEquals(MediaKind.Tap.OPEN, MediaKind.rowTap("artist", true, false));
    }

    @Test public void aSeriesResumes() {
        MediaKind.ActionSet s = MediaKind.actions("series", false);
        assertEquals(Action.RESUME, s.primary);
        assertEquals(Arrays.asList(RowAction.MARK_WATCHED, RowAction.MARK_UNWATCHED), MediaKind.rowMenu("series"));
    }

    @Test public void neverMoreThanFourSecondaryActions() {
        for (String k : new String[] { "album", "playlist", "station", "artist", "author", "speaker", "book", "series" }) {
            for (boolean started : new boolean[] { true, false }) assertTrue(MediaKind.actions(k, started).secondary.size() <= MediaKind.MAX_SECONDARY);
        }
    }

    /** A book part's ⋮ has no Play next; a music track's has. */
    @Test public void rowMenusFollowTheKind() {
        assertEquals(Arrays.asList(RowAction.PLAY_FROM_HERE, RowAction.MARK_FINISHED_UP_TO_HERE), MediaKind.rowMenu("book"));
        assertFalse(MediaKind.rowMenu("book").contains(RowAction.PLAY_NEXT));
        assertEquals(Arrays.asList(RowAction.PLAY_NEXT, RowAction.ADD_TO_QUEUE, RowAction.GO_TO_ALBUM, RowAction.GO_TO_ARTIST,
                RowAction.KEEP_TRACK, RowAction.KEEP_ALBUM), MediaKind.rowMenu("album"));
        assertTrue(MediaKind.searchRowMenu("track").contains(RowAction.KEEP_TRACK));
        assertFalse(MediaKind.rowMenu("book").contains(RowAction.KEEP_TRACK));
        assertTrue(MediaKind.rowMenu("author").isEmpty());
        assertTrue(MediaKind.searchRowMenu("part").isEmpty());
        assertTrue(MediaKind.searchRowMenu("lecture").isEmpty());
        assertTrue(MediaKind.searchRowMenu("track").contains(RowAction.PLAY_NEXT));
    }

    /** Now playing on a book: no shuffle, repeat, lyrics or crossfade; speed and ±30 s stay. */
    @Test public void nowPlayingControlsByKind() {
        MediaKind.Controls book = MediaKind.controls(true);
        assertFalse(book.shuffle);
        assertFalse(book.repeat);
        assertFalse(book.lyrics);
        assertFalse(book.crossfade);
        assertTrue(book.speed);
        assertTrue(book.jumps);
        MediaKind.Controls music = MediaKind.controls(false);
        assertTrue(music.shuffle && music.repeat && music.lyrics && music.crossfade);
    }

    @Test public void childrenAndEdges() {
        assertEquals("speaker", MediaKind.childKind("library-talks", "c:plex:1"));
        assertEquals("series", MediaKind.childKind("speaker", "c:plex:2"));
        assertEquals("Last book", MediaKind.edgeWord("book", false));
        assertEquals("First author", MediaKind.edgeWord("author", true));
    }
}
