package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Before;
import org.junit.Test;

public class NowPlayingNoteTest {
    @Before public void clear() { NowPlayingNote.clearForTests(); }

    @Test public void thePlayingOneWinsThenTheNewer() {
        int[] heard = { 0 };
        NowPlayingNote.listen(() -> heard[0]++);
        NowPlayingNote.update("local", "This phone", "A talk", false, 1);
        NowPlayingNote.update("office-tv", "Office", "A song", true, 2);
        assertEquals("office-tv", NowPlayingNote.current().target);
        NowPlayingNote.update("office-tv", "Office", "A song", false, 3);
        assertEquals("newer of two paused", "office-tv", NowPlayingNote.current().target);
        NowPlayingNote.update("local", "This phone", "A talk", true, 4);
        assertEquals("local", NowPlayingNote.current().target);
        assertEquals(4, heard[0]);
        NowPlayingNote.update("local", "This phone", "A talk", true, 5);
        assertEquals("an unchanged report is not news", 4, heard[0]);
    }

    @Test public void eachTargetHasItsOwnEntryWhicheverIsNewer() {
        NowPlayingNote.update("local", "This phone", "A talk", false, 1);
        NowPlayingNote.update("office-tv", "Office", "A song", true, 2);
        assertEquals("A talk", NowPlayingNote.forTarget("local").title);
        assertEquals("A song", NowPlayingNote.forTarget("office-tv").title);
        org.junit.Assert.assertNull(NowPlayingNote.forTarget("garage-tv"));
    }

    @Test public void anEmptyTitleClearsItsTarget() {
        NowPlayingNote.update("office-tv", "Office", "A song", true, 1);
        NowPlayingNote.update("office-tv", "Office", "", false, 2);
        assertNull(NowPlayingNote.current());
    }

    @Test public void progressIsCarriedForwardWhilePlaying() {
        NowPlayingNote.Entry e = new NowPlayingNote.Entry("local", "This phone", "A song", "Someone", "",
                true, true, 10_000, 100_000, 1_000, null);
        assertEquals(15_000, e.positionAt(6_000));
        assertEquals(0.15f, e.fractionAt(6_000), 0.0001f);
        NowPlayingNote.Entry paused = new NowPlayingNote.Entry("local", "", "A song", "", "", false, false, 10_000, -1, 1_000, null);
        assertEquals(10_000, paused.positionAt(60_000));
        assertEquals(-1f, paused.fractionAt(60_000), 0);
    }

    @Test public void aNewStartIsNeverReplacedByThePreviousItemsReports() {
        NowPlayingNote.update("local", "This phone", "Y", true, 1_000);
        NowPlayingNote.starting("local", "This phone", "X", "by X", "", 2_000);
        assertEquals("X", NowPlayingNote.forTarget("local").title);
        // The player still reports Y, then nothing (our request), for a few seconds.
        NowPlayingNote.update("local", "This phone", "Y", true, 3_000);
        assertEquals("X", NowPlayingNote.forTarget("local").title);
        NowPlayingNote.update("local", "This phone", "", false, 3_500);
        assertEquals("X", NowPlayingNote.forTarget("local").title);
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        // X lands: it replaces the start.
        NowPlayingNote.update("local", "This phone", "X", true, 5_000);
        assertEquals("X", NowPlayingNote.forTarget("local").title);
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
        // And Y's reports count again afterwards (the start is over).
        NowPlayingNote.update("local", "This phone", "Y", true, 6_000);
        assertEquals("Y", NowPlayingNote.forTarget("local").title);
    }

    @Test public void aStartThatNeverLandsLetsThePreviousItemBackAfterItsTime() {
        NowPlayingNote.update("local", "This phone", "Y", true, 0);
        NowPlayingNote.starting("local", "This phone", "X", "", "", 1_000);
        NowPlayingNote.update("local", "This phone", "Y", true, 1_000 + MiniPlayerState.STARTING_MS + 1);
        assertEquals("Y", NowPlayingNote.forTarget("local").title);
    }

    @Test public void aStartKnownOnlyByItsIdSaysStarting() {
        NowPlayingNote.update("local", "This phone", "Y", true, 0);
        NowPlayingNote.starting("local", "This phone", "", "", "", 1);
        assertEquals(NowPlayingNote.STARTING_TITLE, NowPlayingNote.forTarget("local").title);
        assertEquals("", MiniPlayerState.line(NowPlayingNote.forTarget("local")));
    }

    private static NowPlayingNote.Entry chapter(String id, long at) {
        return new NowPlayingNote.Entry("local", "This phone", "Chapter 1", "", "", true, false, 0, -1, at, null, false, "", id);
    }

    @Test public void aNewBookWhoseFirstChapterHasTheOldTitleIsNotHeld() {
        NowPlayingNote.report(chapter("plex:100", 1_000));
        NowPlayingNote.starting("local", "This phone", "Paradise", "Dante", "", 2_000);
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        // The old book's own report is still held...
        NowPlayingNote.report(chapter("plex:100", 2_500));
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        // ...but the new book's first chapter, the same title under another id, lands at once.
        NowPlayingNote.report(chapter("plex:200", 3_000));
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
        assertEquals("plex:200", NowPlayingNote.forTarget("local").mediaId);
    }

    @Test public void aStartWithThePlayingTitleButAnotherIdWritesTheNote() {
        NowPlayingNote.report(chapter("plex:100", 1_000));
        NowPlayingNote.starting("local", "This phone", "Chapter 1", "", "", 2_000, "c:plex:200");
        org.junit.Assert.assertTrue("another book's Chapter 1 is a new start", NowPlayingNote.forTarget("local").starting);
        // The old book's report is held; the new one's lands.
        NowPlayingNote.report(chapter("plex:100", 2_500));
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        NowPlayingNote.report(chapter("plex:200", 3_000));
        assertEquals("plex:200", NowPlayingNote.forTarget("local").mediaId);
    }

    @Test public void aStartOfTheItemAlreadyPlayingWritesNoNote() {
        NowPlayingNote.report(chapter("plex:100", 1_000));
        NowPlayingNote.starting("local", "This phone", "Chapter 1", "", "", 2_000, "p:plex:100|plex:9");
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
        // With no id for the start, the title still says it is the same item.
        NowPlayingNote.starting("local", "This phone", "Chapter 1", "", "", 2_000);
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
    }

    private static NowPlayingNote.Entry track(String title, String id, String listId, long at) {
        return new NowPlayingNote.Entry("local", "This phone", title, "", "", true, false, 0, -1, at, null, false, "", id, listId);
    }

    @Test public void aFailedStartGivesBackWhatPlayedBefore() {
        NowPlayingNote.report(track("Y", "plex:1", "", 1_000));
        NowPlayingNote.starting("local", "This phone", "X", "", "", 2_000, "c:plex:2");
        NowPlayingNote.abandonStart("local", "c:plex:2");
        assertEquals("Y", NowPlayingNote.forTarget("local").title);
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
        // Y's reports count at once again (nothing is held).
        NowPlayingNote.report(track("Y", "plex:1", "", 2_500));
        assertEquals("Y", NowPlayingNote.forTarget("local").title);
        // Nothing before: nothing after.
        NowPlayingNote.clearForTests();
        NowPlayingNote.starting("local", "This phone", "X", "", "", 1_000, "c:plex:2");
        NowPlayingNote.abandonStart("local", "c:plex:2");
        assertNull(NowPlayingNote.forTarget("local"));
        // No start showing: nothing changes.
        NowPlayingNote.report(track("Z", "plex:3", "", 3_000));
        NowPlayingNote.abandonStart("local", "c:plex:2");
        assertEquals("Z", NowPlayingNote.forTarget("local").title);
    }

    @Test public void reTappingThePlayingAlbumIsNotHeld() {
        // Its track plays with no list id; the tap writes a start.
        NowPlayingNote.report(track("Main title", "plex:77", "", 1_000));
        NowPlayingNote.starting("local", "This phone", "The Album", "", "", 2_000, "c:plex:50");
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        // The player reloads the same track, now as the start of the tapped list: it lands at once.
        NowPlayingNote.report(track("Main title", "plex:77", "plex:50", 2_400));
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
        // Tapped again while the bar knows its list: no start at all.
        NowPlayingNote.starting("local", "This phone", "The Album", "", "", 3_000, "c:plex:50");
        org.junit.Assert.assertFalse(NowPlayingNote.forTarget("local").starting);
    }

    @Test public void theSameItemIsToldByItsContentIdOnBothSides() {
        org.junit.Assert.assertTrue(NowPlayingNote.sameItem(track("A", "p:plex:1|plex:9", "", 0), track("B", "plex:1", "", 0)));
        org.junit.Assert.assertFalse(NowPlayingNote.sameItem(track("A", "c:plex:1", "", 0), track("A", "plex:2", "", 0)));
    }

    @Test public void aLateFailureNeverUndoesANewerStart() {
        NowPlayingNote.report(track("Y", "plex:1", "", 1_000));
        NowPlayingNote.starting("local", "This phone", "X", "", "", 2_000, "c:plex:2");
        NowPlayingNote.starting("local", "This phone", "Z", "", "", 2_100, "c:plex:3");
        NowPlayingNote.abandonStart("local", "c:plex:2"); // X's failure, after Z was tapped
        assertEquals("Z", NowPlayingNote.forTarget("local").title);
        org.junit.Assert.assertTrue(NowPlayingNote.forTarget("local").starting);
        NowPlayingNote.abandonStart("local", "c:plex:3");
        assertEquals("Y", NowPlayingNote.forTarget("local").title);
    }

    @Test public void aSecondStartOverAShowingOneTakesItsId() {
        NowPlayingNote.report(track("Y", "plex:1", "", 1_000));
        NowPlayingNote.starting("local", "This phone", "Starting…", "", "", 2_000, "");
        // The widget's action names its item: the start now waits for that id.
        NowPlayingNote.starting("local", "This phone", "Morning", "", "", 2_100, "c:plex:60");
        NowPlayingNote.report(track("Y", "plex:1", "", 2_200));
        assertEquals("Y's report is still held", "Morning", NowPlayingNote.forTarget("local").title);
        NowPlayingNote.report(track("Track 1", "plex:61", "plex:60", 2_300));
        assertEquals("Track 1", NowPlayingNote.forTarget("local").title);
    }
}
