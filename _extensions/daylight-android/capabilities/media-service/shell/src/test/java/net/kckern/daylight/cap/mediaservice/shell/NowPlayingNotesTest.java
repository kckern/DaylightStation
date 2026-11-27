package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;


import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import org.junit.Test;

public class NowPlayingNotesTest {
    @Test public void aCarTapShowsWhatWasTappedOnTheMiniPlayer() {
        MediaItem album = new MediaItem.Builder().setMediaId("c:plex:50").setMediaMetadata(new MediaMetadata.Builder()
                .setTitle("Blue").setAlbumArtist("Joni Mitchell").build()).build();
        assertArrayEquals(new String[] { "Blue", "Joni Mitchell", "" }, NowPlayingNotes.face(album));
        MediaItem track = new MediaItem.Builder().setMediaId("p:plex:51|plex:50").setMediaMetadata(new MediaMetadata.Builder()
                .setTitle("River").setArtist("Joni").setAlbumArtist("Joni Mitchell").build()).build();
        assertArrayEquals(new String[] { "River", "Joni", "" }, NowPlayingNotes.face(track));
    }

    @Test public void aRequestWithNoTitleHasNoFace() {
        assertNull(NowPlayingNotes.face(new MediaItem.Builder().setMediaId("c:plex:50").build()));
        assertNull(NowPlayingNotes.face(null));
        assertNull("a title of spaces is none", NowPlayingNotes.face(new MediaItem.Builder().setMediaId("c:plex:50")
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("   ").build()).build()));
    }

    @Test public void anItemsListIsItsListIdElseTheListItStartsFromATap() {
        assertEquals("plex:9", NowPlayingNotes.listOf("plex:9", new QueueTag("Blue", "c:plex:50", false)));
        assertEquals("the start item of a tapped album", "c:plex:50", NowPlayingNotes.listOf("", new QueueTag("Blue", "c:plex:50", false)));
        assertEquals("a tapped track is not a list", "", NowPlayingNotes.listOf("", new QueueTag("Blue", "p:plex:51|plex:50", false)));
        assertEquals("", NowPlayingNotes.listOf(null, null));
    }
}
