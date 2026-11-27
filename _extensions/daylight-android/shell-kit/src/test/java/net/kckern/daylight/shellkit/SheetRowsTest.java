package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class SheetRowsTest {
    private static SheetRows.Row r(String label, boolean destructive) { return new SheetRows.Row(0, label, null, destructive, null); }

    @Test public void destructiveRowsGoLastAfterOneDivider() {
        List<SheetRows.Slot> s = SheetRows.layout(Arrays.asList(
                r("Open", false), r("Remove from Continue listening", true), r("Keep on this phone", false), r("Mark finished", false)));
        assertEquals(5, s.size());
        assertEquals("Open", s.get(0).row.label);
        assertEquals("Keep on this phone", s.get(1).row.label);
        assertEquals("Mark finished", s.get(2).row.label);
        assertTrue(s.get(3).divider());
        assertEquals("Remove from Continue listening", s.get(4).row.label);
    }

    @Test public void noDividerWhenOneGroupIsEmpty() {
        assertEquals(1, SheetRows.layout(Collections.singletonList(r("Remove from this phone", true))).size());
        List<SheetRows.Slot> plain = SheetRows.layout(Arrays.asList(r("Play next", false), r("Add to queue", false)));
        assertEquals(2, plain.size());
        for (SheetRows.Slot x : plain) assertFalse(x.divider());
        assertTrue(SheetRows.layout(null).isEmpty());
    }

    @Test public void kindsHaveTheirOwnPlaceholderGlyph() {
        assertEquals(CoverGlyph.Kind.BOOK, CoverGlyph.of("book"));
        assertEquals(CoverGlyph.Kind.PERSON, CoverGlyph.of("author"));
        assertEquals(CoverGlyph.Kind.PERSON, CoverGlyph.of("artist"));
        assertEquals(CoverGlyph.Kind.PLAYLIST, CoverGlyph.of("playlist"));
        assertEquals(CoverGlyph.Kind.ALBUM, CoverGlyph.of(null));
        assertEquals(CoverGlyph.Kind.BOOK, CoverGlyph.of("lecture"));
    }
}
