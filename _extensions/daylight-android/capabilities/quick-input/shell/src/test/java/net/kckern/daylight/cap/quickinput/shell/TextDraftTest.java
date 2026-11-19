package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

public class TextDraftTest {
    private static String repeat(String s, int n) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < n; i++) out.append(s);
        return out.toString();
    }

    /** The intake takes 16,384 bytes of UTF-8 for a text input. */
    @Test public void theLimitIsTheIntakes() {
        assertEquals(16_384, TextDraft.MAX_BYTES);
    }

    @Test public void lengthIsCountedInUtf8BytesNotInCharacters() {
        assertEquals(0, TextDraft.utf8Length("", 0, 0));
        assertEquals(5, TextDraft.utf8Length("hello", 0, 5));
        assertEquals(2, TextDraft.utf8Length("é", 0, 1));
        assertEquals(3, TextDraft.utf8Length("한", 0, 1));
        assertEquals("one emoji is two chars and four bytes", 4, TextDraft.utf8Length("🍜", 0, 2));
        assertEquals(3, TextDraft.utf8Length("a한b", 1, 2));
        String mixed = "Dinner: 비빔밥 🍜, café";
        assertEquals(mixed.getBytes(StandardCharsets.UTF_8).length, TextDraft.utf8Length(mixed, 0, mixed.length()));
    }

    @Test public void whatIsTypedIsAcceptedWhileItFits() {
        assertEquals("all of it", 5, TextDraft.accepted(0, "hello", 0, 5, 16));
        assertEquals(5, TextDraft.accepted(11, "hello", 0, 5, 16));
        assertEquals("only what fits", 4, TextDraft.accepted(12, "hello", 0, 5, 16));
        assertEquals(0, TextDraft.accepted(16, "hello", 0, 5, 16));
        assertEquals("already over (a paste into a restored draft): nothing more", 0, TextDraft.accepted(20, "hello", 0, 5, 16));
        assertEquals("a part of the source", 2, TextDraft.accepted(14, "hello", 1, 5, 16));
    }

    @Test public void aCharacterOfSeveralBytesIsTakenWholeOrNotAtAll() {
        assertEquals(1, TextDraft.accepted(13, "한", 0, 1, 16));
        assertEquals("three bytes do not fit in two", 0, TextDraft.accepted(14, "한", 0, 1, 16));
        assertEquals("two of the three fit", 2, TextDraft.accepted(10, "한한한", 0, 3, 16));
        String bowls = "🍜🍜";
        assertEquals("a pair is never split: one whole emoji", 2, TextDraft.accepted(10, bowls, 0, 4, 16));
        assertEquals(0, TextDraft.accepted(13, bowls, 0, 4, 16));
        assertEquals(4, TextDraft.accepted(8, bowls, 0, 4, 16));
    }

    @Test public void aDraftAtTheLimitTakesNothingMoreWhateverIsTyped() {
        String full = repeat("a", TextDraft.MAX_BYTES);
        assertEquals(0, TextDraft.accepted(TextDraft.utf8Length(full, 0, full.length()), "b", 0, 1, TextDraft.MAX_BYTES));
        String korean = repeat("한", TextDraft.MAX_BYTES / 3);      // 16,383 bytes
        int kept = TextDraft.utf8Length(korean, 0, korean.length());
        assertEquals(16_383, kept);
        assertEquals("one byte is left: a letter fits", 1, TextDraft.accepted(kept, "a", 0, 1, TextDraft.MAX_BYTES));
        assertEquals("and a syllable does not", 0, TextDraft.accepted(kept, "한", 0, 1, TextDraft.MAX_BYTES));
    }

    @Test public void theBodyIsTheTextAsUtf8WithoutTheSpaceAroundIt() {
        assertArrayEquals("Oatmeal, banana".getBytes(StandardCharsets.UTF_8), TextDraft.body("  Oatmeal, banana\n\n"));
        assertArrayEquals("two\nlines".getBytes(StandardCharsets.UTF_8), TextDraft.body("two\nlines"));
        assertArrayEquals("비빔밥".getBytes(StandardCharsets.UTF_8), TextDraft.body("비빔밥"));
    }

    /** The intake refuses a body with no non-whitespace character, so one is never queued. */
    @Test public void nothingButSpaceIsNothingToSend() {
        for (String blank : new String[] { null, "", " ", "\n\n\t ", "  ", " ", "﻿", "​" }) {
            assertNull(TextDraft.body(blank));
        }
    }

    /** The filter keeps a draft under the limit; a draft that is over anyway is not sent. */
    @Test public void aBodyOverTheLimitIsNotOne() {
        assertNotNull(TextDraft.body(repeat("a", TextDraft.MAX_BYTES)));
        assertNull(TextDraft.body(repeat("a", TextDraft.MAX_BYTES + 1)));
        assertNull(TextDraft.body(repeat("한", TextDraft.MAX_BYTES / 3 + 1)));
        assertEquals("space around it is not counted against it", TextDraft.MAX_BYTES,
                TextDraft.body("  " + repeat("a", TextDraft.MAX_BYTES) + "\n").length);
    }

    @Test public void theCounterAppearsOnlyNearTheLimit() {
        assertEquals("", TextDraft.counter(0));
        assertEquals("", TextDraft.counter(12_000));
        assertEquals("1,384 bytes left", TextDraft.counter(15_000));
        assertEquals("1 byte left", TextDraft.counter(16_383));
        assertEquals("At the limit", TextDraft.counter(16_384));
        assertEquals("At the limit", TextDraft.counter(20_000));
    }
}
