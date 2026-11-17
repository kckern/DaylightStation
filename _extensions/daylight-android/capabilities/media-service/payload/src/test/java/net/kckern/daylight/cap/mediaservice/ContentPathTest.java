package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.junit.Test;

public class ContentPathTest {
    @Test public void aContentIdBecomesPathSegments() {
        assertEquals("/api/v1/list/plex/12345", ContentPath.of("list", "plex:12345"));
        assertEquals("/api/v1/queue/libby/loan/c1/t2", ContentPath.of("queue", "libby:loan/c1/t2"));
        assertEquals("/api/v1/play/files/clips/pull%20up%20%231", ContentPath.of("play", "files:clips/pull up #1"));
        assertEquals("a source with no local id is its top level", "/api/v1/list/plex", ContentPath.of("list", "plex:"));
    }

    @Test public void refusesAnythingThatIsNotAContentId() {
        for (String bad : new String[] { null, "", "12345", ":12345", "plex/..:1", "plex:../../admin", "plex:a/./b",
                "plex:a\\b", "plex:a|b", "plex:a\nb", "PLEX:1", "http://evil.example/a.mp3", "plex:a//b", "plex:/a" }) {
            assertFalse("accepted " + bad, ContentId.valid(bad));
            try { ContentPath.of("list", bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    /**
     * The backend takes these path segments out of an id and reads them as modifiers
     * (shuffle picks a random item, playable changes what a list holds). An id that
     * holds one would ask for something other than what it names.
     */
    @Test public void aSegmentTheBackendReadsAsAModifierIsRefused() {
        for (String bad : new String[] { "plex:10/shuffle", "plex:shuffle", "files:a/playable/b", "plex:10/expand", "plex:10/launchable",
                "plex:10/recent_on_top", "plex:10/shuffle,playable", "plex:10/x,expand" }) {
            assertFalse("accepted " + bad, ContentId.valid(bad));
        }
        assertTrue("only a whole segment counts", ContentId.valid("files:music/shuffled/a.mp3"));
        assertTrue(ContentId.valid("files:a,b/c.mp3"));
    }

    @Test public void aContentIdIsBoundedInLength() {
        StringBuilder longId = new StringBuilder("plex:");
        for (int i = 0; i < 500; i++) longId.append('a');
        assertFalse(ContentId.valid(longId.toString()));
        assertTrue(ContentId.valid("plex:12345"));
        assertTrue(ContentId.valid("plex:"));
        assertEquals("plex", ContentId.source("plex:12345"));
    }
}
