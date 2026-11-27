package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertArrayEquals;
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
    }
}
