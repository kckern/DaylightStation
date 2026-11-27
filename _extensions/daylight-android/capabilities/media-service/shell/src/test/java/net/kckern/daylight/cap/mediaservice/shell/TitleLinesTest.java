package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TitleLinesTest {
    /** mk-16: the part and the book had the same name and showed twice. */
    @Test public void aBookNeverShowsTheSameTextTwice() {
        TitleLines l = TitleLines.of(true, "", "Paradise - Benedict Flynn translation", "Paradise - Benedict Flynn translation", "Dante Alighieri", 2010);
        assertEquals("Paradise - Benedict Flynn translation", l.title);
        assertEquals("", l.album);
        assertEquals("Dante Alighieri", l.by);
    }

    @Test public void aChapteredBookLeadsWithTheChapter() {
        TitleLines l = TitleLines.of(true, "Canto 24", "Paradise - Benedict Flynn translation", "Paradise - Benedict Flynn translation", "Dante Alighieri", 0);
        assertEquals("Canto 24", l.title);
        assertEquals("Paradise - Benedict Flynn translation", l.album);
        assertEquals("Dante Alighieri", l.by);
    }

    @Test public void aBooksPartThenTheBookThenTheAuthor() {
        TitleLines l = TitleLines.of(true, "", "A Path of Destruction", "Richard III", "William Shakespeare", 1593);
        assertEquals("A Path of Destruction", l.title);
        assertEquals("Richard III", l.album);   // no year on a book
        assertEquals("William Shakespeare", l.by);
    }

    @Test public void musicKeepsItsSleeve() {
        TitleLines l = TitleLines.of(false, "", "Hey Jude", "Past Masters", "The Beatles", 1988);
        assertEquals("Hey Jude", l.title);
        assertEquals("Past Masters (1988)", l.album);
        assertEquals("The Beatles", l.by);
        assertEquals("", TitleLines.of(false, "", "Björk", "Debut", "björk", 0).by);
    }
}
