package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The TalkBack action every long-press surface offers. */
public class MoreOptionsTest {
    @Test public void namesTheItem() {
        assertEquals("More options for Track 1", MoreOptions.label("Track 1"));
    }

    @Test public void aBlankTitleStillSaysSomething() {
        assertEquals("More options for this item", MoreOptions.label("  "));
        assertEquals("More options for this item", MoreOptions.label(null));
    }
}
