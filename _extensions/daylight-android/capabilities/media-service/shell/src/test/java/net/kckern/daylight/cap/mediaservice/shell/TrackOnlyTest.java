package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/** Play next and Add to queue on one track add that track, never its album (acceptance 212, "· 19 tracks"). */
public class TrackOnlyTest {
    private static final List<String> ALBUM = Arrays.asList("plex:10", "plex:11", "plex:12", "plex:13");

    @Test public void aTrackRowAddsItsOwnTrackFromTheAnswerOfItsWholeAlbum() {
        assertEquals(2, FirstTap.onlyTrack("p:plex:12|plex:1", ALBUM, 0));
        assertEquals(2, FirstTap.onlyTrack("p:plex:12", ALBUM, 0));
    }

    @Test public void whenTheIdIsNotInTheAnswerTheStartIndexNamesIt() {
        assertEquals(3, FirstTap.onlyTrack("p:plex:99", ALBUM, 3));
        assertEquals(0, FirstTap.onlyTrack("p:plex:99", ALBUM, 40));
    }

    @Test public void aContainerAddsWhole() {
        assertEquals(-1, FirstTap.onlyTrack("c:plex:1", ALBUM, 0));
        assertEquals(-1, FirstTap.onlyTrack("plex:1", ALBUM, 0));
        assertEquals(-1, FirstTap.onlyTrack(null, ALBUM, 0));
    }
}
