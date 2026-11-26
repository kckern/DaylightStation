package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

public class ShareActivityTest {
    @Test public void takesTheSharedTextOrElseTheSubject() {
        assertEquals("Look https://example.com/v", ShareActivity.sharedText("Look https://example.com/v", "Title"));
        assertEquals("Title https://example.com/v", ShareActivity.sharedText("  ", "Title https://example.com/v"));
    }

    @Test public void nothingSharedIsNothingToSend() {
        assertNull(ShareActivity.sharedText(null, null));
        assertNull(ShareActivity.sharedText(" \n ", ""));
    }

    @Test public void keepsTheStartOfTextOverTheIntakesLimit() {
        StringBuilder big = new StringBuilder("https://example.com/v ");
        while (big.length() < 40_000) big.append("word ");
        String kept = ShareActivity.sharedText(big.toString(), null);
        assertNotNull(kept);
        assertTrue(kept.startsWith("https://example.com/v"));
        assertTrue(kept.getBytes(StandardCharsets.UTF_8).length <= TextDraft.MAX_BYTES);
    }

    @Test public void previewsTheFirstLineShort() {
        assertEquals("A title", ShareActivity.preview("A title\nhttps://example.com/v"));
        StringBuilder longLine = new StringBuilder();
        while (longLine.length() < 200) longLine.append('x');
        assertEquals(80, ShareActivity.preview(longLine.toString()).length());
    }
}
