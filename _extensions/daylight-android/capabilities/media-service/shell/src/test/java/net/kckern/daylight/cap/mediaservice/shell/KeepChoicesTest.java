package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class KeepChoicesTest {
    @Test public void aMusicTrackOffersTheTrackThenTheAlbum() {
        assertEquals(Arrays.asList("track", "album"), KeepChoices.of("music", true));
        assertEquals(Arrays.asList("track", "album"), KeepChoices.of("track", true));
        assertEquals("Keep this track", KeepChoices.words("track"));
        assertEquals("Keep the album", KeepChoices.words("album"));
    }

    @Test public void aBookIsAlwaysWhole() {
        assertEquals(Collections.singletonList("book"), KeepChoices.of("book", true));
        assertEquals(Collections.singletonList("book"), KeepChoices.of("part", true));
        assertEquals(Collections.singletonList("book"), KeepChoices.of("lecture", true));
    }

    @Test public void aPageKeepsItsWhole() {
        assertEquals(Collections.singletonList("album"), KeepChoices.of("album", false));
        assertEquals(Collections.singletonList("list"), KeepChoices.of("playlist", false));
    }

    @Test public void onMobileDataTheSheetOffersOnceNotARule() {
        assertTrue(KeepChoices.offerMobileOnce(/*onMobile*/ true, /*mobileAllowed*/ false));
        assertFalse(KeepChoices.offerMobileOnce(false, false));
        assertFalse(KeepChoices.offerMobileOnce(true, true));
    }

    @Test public void theSheetShowsOnlyWhenThereIsAChoice() {
        assertTrue(KeepChoices.asks(KeepChoices.of("track", true), false));
        assertFalse(KeepChoices.asks(KeepChoices.of("book", true), false));
        assertTrue(KeepChoices.asks(KeepChoices.of("book", true), true));
    }

    @Test public void aOneTrackKeepAsksThePayloadForThatTrackOnly() {
        String id = KeepChoices.trackKeepId("p:plex:20|plex:9");
        assertEquals("p:plex:20|plex:9#track", id);
        assertEquals("p:plex:20|plex:9", KeepChoices.baseId(id));
        assertEquals(Collections.singletonList("plex:20"), KeepChoices.onlyOf(id));
        assertTrue("the album keep of the same track is the whole", KeepChoices.onlyOf("p:plex:20|plex:9").isEmpty());
        assertEquals(id, KeepChoices.trackKeepId(id));
    }

    /** "Download now on mobile data": the sync it starts sees everything ready (the new keep is not listed yet) and must not end the "once". */
    @Test public void mobileOnceSurvivesTheSyncItStartsBeforeTheKeepIsListed() {
        assertFalse(KeepChoices.mobileOnceDone(true, 1_000, 1_000 + 5_000));
    }

    @Test public void mobileOnceEndsWhenEverythingIsReadyAfterTheGracePeriod() {
        assertTrue(KeepChoices.mobileOnceDone(true, 1_000, 1_000 + KeepChoices.MOBILE_ONCE_GRACE_MS + 1));
    }

    @Test public void mobileOnceStaysWhileSomethingIsStillDownloading() {
        assertFalse(KeepChoices.mobileOnceDone(false, 1_000, 1_000 + 10 * KeepChoices.MOBILE_ONCE_GRACE_MS));
    }

    @Test public void aMobileOnceWithNoRecordedTimeEndsWhenReady() {
        assertTrue(KeepChoices.mobileOnceDone(true, 0, 5_000));
    }

    /** A reboot or a clock set back makes "now" earlier than when it was asked: the once is over, ready or not. */
    @Test public void mobileOnceIsOverWhenTheClockIsBeforeWhenItWasAsked() {
        assertFalse(KeepChoices.mobileOnceOn(10_000, 5_000));
        assertTrue(KeepChoices.mobileOnceDone(true, 10_000, 5_000));
        assertTrue(KeepChoices.mobileOnceOn(10_000, 10_000));
        assertTrue(KeepChoices.mobileOnceOn(0, 5_000));
    }
}
