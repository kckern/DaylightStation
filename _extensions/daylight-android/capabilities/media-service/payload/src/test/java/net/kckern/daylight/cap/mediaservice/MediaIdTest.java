package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.junit.Test;

public class MediaIdTest {
    @Test public void theFixedNodesAndTheThreeIdForms() {
        assertEquals(MediaId.Kind.ROOT, MediaId.parse("root").kind);
        assertEquals(MediaId.Kind.RECENT, MediaId.parse("recent").kind);
        assertEquals(MediaId.Kind.CATALOG, MediaId.parse("catalog").kind);

        MediaId container = MediaId.parse("c:plex:10");
        assertEquals(MediaId.Kind.CONTAINER, container.kind);
        assertEquals("plex:10", container.contentId);
        assertEquals(0, container.skip);

        MediaId more = MediaId.parse("m:200|plex:10");
        assertEquals(MediaId.Kind.CONTAINER, more.kind);
        assertEquals("plex:10", more.contentId);
        assertEquals(200, more.skip);

        MediaId leaf = MediaId.parse("p:plex:11|plex:10");
        assertEquals(MediaId.Kind.LEAF, leaf.kind);
        assertEquals("plex:11", leaf.contentId);
        assertEquals("plex:10", leaf.parent);
        assertNull(MediaId.parse("p:plex:11").parent);
    }

    @Test public void idsAreWrittenTheWayTheyAreRead() {
        assertEquals("c:plex:10", MediaId.container("plex:10"));
        assertEquals("m:200|plex:10", MediaId.more("plex:10", 200));
        assertEquals("p:plex:11|plex:10", MediaId.leaf("plex:11", "plex:10"));
        assertEquals("p:plex:11", MediaId.leaf("plex:11", null));
    }

    /** A media id comes back from a car, a link or any media browser on the phone. */
    @Test public void anythingElseIsRefusedAndNeverAUrl() {
        for (String bad : new String[] { null, "", "x:plex:20", "c:", "c:12345", "p:plex:1|", "p:plex:1|nope", "p:plex:1|plex:2|plex:3",
                "m:-1|plex:10", "m:abc|plex:10", "m:999999999999|plex:10", "m:200", "https://evil.example/a.mp3",
                "p:https://evil.example/a.mp3", "c:plex:../../etc", "Root", " root" }) {
            try { MediaId.parse(bad); fail("accepted " + bad); }
            catch (IllegalArgumentException expected) { assertEquals("unknown media id", expected.getMessage()); }
        }
    }
}
