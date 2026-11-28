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

    @Test public void aTrackRowWhoseIdIsNotInTheAnswerFallsBackToTheStartIndexOnlyInAListAnswer() {
        assertEquals(3, FirstTap.onlyTrack("p:plex:99|plex:1", ALBUM, 3));
        assertEquals("out of range: add whole as before", -1, FirstTap.onlyTrack("p:plex:99|plex:1", ALBUM, 40));
        assertEquals("a one-track answer is not a list", -1, FirstTap.onlyTrack("p:plex:99|plex:1", Arrays.asList("plex:10"), 0));
    }

    @Test public void aWholeCollectionArrivingAsPColonStaysWhole() {
        assertEquals("p:<book> is not in the answer: never just part 1", -1, FirstTap.onlyTrack("p:plex:99", ALBUM, 0));
        assertEquals(-1, FirstTap.onlyTrack("p:plex:99", ALBUM, 2));
    }

    @Test public void aTrackThatAppearsTwiceTakesTheOccurrenceTheStartIndexNames() {
        List<String> twice = Arrays.asList("plex:10", "plex:11", "plex:12", "plex:11");
        assertEquals(3, FirstTap.onlyTrack("p:plex:11|plex:1", twice, 3));
        assertEquals(1, FirstTap.onlyTrack("p:plex:11|plex:1", twice, 0));
    }

    @Test public void aContainerAddsWhole() {
        assertEquals(-1, FirstTap.onlyTrack("c:plex:1", ALBUM, 0));
        assertEquals(-1, FirstTap.onlyTrack("plex:1", ALBUM, 0));
        assertEquals(-1, FirstTap.onlyTrack(null, ALBUM, 0));
    }
}
