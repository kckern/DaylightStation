package net.kckern.daylight.cap.bookmarks;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class BookmarksTest {
    private static String message(String... lines) {
        try { Bookmarks.parse(Arrays.asList(lines)); } catch (IllegalArgumentException e) { return e.getMessage(); }
        fail("expected IllegalArgumentException");
        return null;
    }

    @Test public void parsesLinesAndSkipsEmptySlots() {
        Bookmarks b = Bookmarks.parse(Arrays.asList("feed|Feed|open|/feed", "", "  ", "media|Media|play|/media?tab=recent"));
        assertEquals(2, b.items.size());
        assertEquals("feed", b.items.get(0).id);
        assertEquals("Feed", b.items.get(0).label);
        assertEquals("open", b.items.get(0).icon);
        assertEquals("/media?tab=recent", b.find("media").path);
        assertNull(b.find("call"));
    }

    @Test public void namesTheSlotOfABadLine() {
        assertTrue(message("feed|Feed|open|/feed", "media|Media|/media").contains("bookmarks.2: expected id|label|icon|path"));
    }

    @Test public void rejectsABadIdLabelIconOrPath() {
        assertTrue(message("Feed|Feed|open|/feed").contains("id must match"));
        assertTrue(message("feed||open|/feed").contains("label"));
        assertTrue(message("feed|" + "x".repeat(41) + "|open|/feed").contains("label"));
        assertTrue(message("feed|Feed|Open Sesame|/feed").contains("icon"));
        assertTrue(message("feed|Feed|open|feed").contains("path"));
        assertTrue(message("feed|Feed|open|//evil.example/").contains("path"));
        assertTrue(message("feed|Feed|open|https://evil.example/").contains("path"));
        assertTrue("a bookmark is a page, never an API route", message("x|X|open|/api/v1/home/scenes/all-off").contains("path"));
    }

    @Test public void rejectsAnIdUsedTwice() {
        assertTrue(message("feed|Feed|open|/feed", "feed|Again|open|/feed2").contains("bookmarks.2: id 'feed' is used twice"));
    }

    @Test public void oneLineCanBeCheckedOnItsOwn() {
        assertNull(Bookmarks.problem(""));
        assertNull(Bookmarks.problem("feed|Feed|open|/feed"));
        assertTrue(Bookmarks.problem("feed|Feed|open").contains("expected id|label|icon|path"));
    }

    @Test public void theLenientReadKeepsTheGoodLinesAndReportsTheRest() {
        List<String> problems = new ArrayList<>();
        Bookmarks b = Bookmarks.usable(Arrays.asList("feed|Feed|open|/feed", "broken", "feed|Again|open|/x", "call|Call|open|/call"), problems);
        assertEquals(2, b.items.size());
        assertEquals("/feed", b.find("feed").path);
        assertNotNull(b.find("call"));
        assertEquals(2, problems.size());
        assertTrue(problems.get(0).startsWith("bookmarks.2:"));
        assertTrue(problems.get(1).contains("used twice"));
    }
}
