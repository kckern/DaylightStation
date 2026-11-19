package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.junit.Test;

/** What a page may ask to pin: a content id by the media service's own rule, and a short plain label. */
public class PinRequestTest {
    @Test public void aContentIdAndAPlainLabelAreAccepted() {
        assertNull(PinRequest.problem("plex:12345", "Morning music"));
        assertNull(PinRequest.problem("files:music/albums/one", "A"));
        assertNull(PinRequest.problem("plex:1", "Ein Lied für dich 🎵"));
        assertNull("forty visible characters", PinRequest.problem("plex:1", "1234567890123456789012345678901234567890"));
    }

    /** The content id rule is the media service's (ContentId): never a URL, a relative segment or a modifier. */
    @Test public void aContentIdThatIsAUrlHoldsDotDotOrAModifierIsRefused() {
        for (String bad : new String[] { null, "", "https://evil.example/a.mp3", "http://192.0.2.1/x", "javascript:alert(1)",
                "data:text/html,x", "file:/etc/hosts", "intent:#Intent;end", "content:x", "daylight:action/radio",
                "plex:../admin", "plex:a/../../b", "plex:a/./b", "plex:a//b", "plex:12345/shuffle", "plex:12345/playable",
                "plex:1,shuffle", "plex:a\\b", "plex:a|b", "plex:a\u0000b", "PLEX:1", "noColon" }) {
            assertEquals(String.valueOf(bad), PinRequest.INVALID_CONTENT_ID, PinRequest.problem(bad, "Label"));
        }
    }

    @Test public void aHostileLabelIsRefused() {
        for (String bad : new String[] { null, "", "   ", "a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b",
                "‮evil", "a‪b", "a⁦b", "a⁧b", "a⁨b", "a⁩b", "a‎b", "a‏b", "a؜b",
                "a​b", "a﻿b", "a b", "a b", "a\uD800b",
                "12345678901234567890123456789012345678901" }) {
            assertEquals(String.valueOf(bad), PinRequest.INVALID_LABEL, PinRequest.problem("plex:1", bad));
        }
    }

    @Test public void theLabelIsTrimmedBeforeItIsCounted() {
        assertEquals("Radio", PinRequest.label("  Radio  "));
        assertNull(PinRequest.problem("plex:1", "  1234567890123456789012345678901234567890  "));
    }
}
