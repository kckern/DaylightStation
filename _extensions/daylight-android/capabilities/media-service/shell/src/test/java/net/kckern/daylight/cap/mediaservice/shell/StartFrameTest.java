package net.kckern.daylight.cap.mediaservice.shell;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class StartFrameTest {
    @Test public void aBookStartsAsABookFrame() {
        StartFrame f = StartFrame.of(true, "Henry VI Part 3", "William Shakespeare");
        assertEquals("Henry VI Part 3", f.title);
        assertEquals("William Shakespeare", f.by);
        assertTrue(f.byBelow);                // the author under the book's line, as the playing frame
        assertTrue(f.jumps);
        assertFalse(f.quality);
        assertTrue(f.controls.speed);
        assertFalse(f.controls.shuffle);
        assertFalse(f.controls.repeat);
        assertFalse(f.controls.lyrics);
    }

    @Test public void musicStartsAsASleeve() {
        StartFrame f = StartFrame.of(false, "Snakes & Arrows", "Rush");
        assertFalse(f.byBelow);
        assertFalse(f.jumps);
        assertTrue(f.quality);
        assertTrue(f.controls.shuffle);
        assertTrue(f.controls.repeat);
        assertTrue(f.controls.lyrics);
        assertFalse(f.controls.speed);
    }

    @Test public void noTitleSaysStartingAndARepeatedBylineIsDropped() {
        assertEquals("Starting…", StartFrame.of(true, "", null).title);
        assertEquals("", StartFrame.of(false, "Rush", "rush").by);
    }
}
