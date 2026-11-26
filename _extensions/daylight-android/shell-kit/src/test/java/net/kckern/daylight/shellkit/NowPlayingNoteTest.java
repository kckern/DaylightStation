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
}
