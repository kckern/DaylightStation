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
}
