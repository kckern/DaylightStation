package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.List;

public class AnswersTest {
    @Test public void aBrowseAnswerBecomesEntries() throws Exception {
        List<BrowseAnswer.Entry> entries = BrowseAnswer.parse("{\"ok\":true,\"items\":["
                + "{\"id\":\"c:plex:10\",\"title\":\"Kind of Blue\",\"subtitle\":\"Miles Davis\",\"artUrl\":\"https://kiosk.example/t/10\",\"browsable\":true,\"playable\":false},"
                + "{\"id\":\"p:plex:11|plex:10\",\"title\":\"So What\",\"browsable\":false,\"playable\":true}]}");
        assertEquals(2, entries.size());
        assertEquals("c:plex:10", entries.get(0).id);
        assertEquals("Miles Davis", entries.get(0).subtitle);
        assertEquals("https://kiosk.example/t/10", entries.get(0).artUrl);
        assertTrue(entries.get(0).browsable);
        assertTrue(entries.get(1).playable);
        assertEquals("", entries.get(1).subtitle);
        assertNull(entries.get(1).artUrl);
    }

    @Test public void anImageThatIsNotHttpsIsNeverHandedOn() throws Exception {
        for (String art : new String[] { "http://192.0.2.10/t/10", "content://other.app/x", "file:///sdcard/x.png", "javascript:alert(1)", "" }) {
            List<BrowseAnswer.Entry> entries = BrowseAnswer.parse("{\"ok\":true,\"items\":[{\"id\":\"c:plex:10\",\"title\":\"A\",\"artUrl\":\""
                    + art + "\",\"browsable\":true}]}");
            assertNull(art, entries.get(0).artUrl);
        }
    }

    @Test public void anEntryWithNoIdOrTitleIsLeftOutAndALevelIsBounded() throws Exception {
        assertTrue(BrowseAnswer.parse("{\"ok\":true,\"items\":[{\"title\":\"A\"},{\"id\":\"c:plex:1\"},null,7]}").isEmpty());
        assertTrue(BrowseAnswer.parse("{\"ok\":true}").isEmpty());
        StringBuilder many = new StringBuilder("{\"ok\":true,\"items\":[");
        for (int i = 0; i < BrowseAnswer.MAX_ENTRIES + 20; i++) {
            if (i > 0) many.append(',');
            many.append("{\"id\":\"c:plex:").append(i).append("\",\"title\":\"A\",\"browsable\":true}");
        }
        assertEquals(BrowseAnswer.MAX_ENTRIES, BrowseAnswer.parse(many.append("]}").toString()).size());
    }

    @Test public void aRefusalOrSomethingThatIsNotAnAnswerIsAFailure() {
        for (String bad : new String[] { "{\"ok\":false,\"error\":\"unreachable\"}", "not json", "", null, "[]" }) {
            try { BrowseAnswer.parse(bad); fail("accepted " + bad); } catch (BrowseAnswer.Failed expected) { }
            try { TrackAnswer.parse(bad); fail("accepted " + bad); } catch (BrowseAnswer.Failed expected) { }
        }
    }

    /** The fallback while no payload is loaded: one tab that says so, and nothing under it. */
    @Test public void whileThePayloadIsStartingTheRootHasOneEntryThatSaysSo() {
        List<BrowseAnswer.Entry> root = BrowseAnswer.starting();
        assertEquals(1, root.size());
        assertEquals(BrowseAnswer.STARTING_ID, root.get(0).id);
        assertEquals("Daylight is starting", root.get(0).title);
        assertTrue("a car shows the root's children as tabs, which are browsable", root.get(0).browsable);
        assertFalse(root.get(0).playable);
    }

    @Test public void aResolveAnswerBecomesTracksAndWhereToStart() throws Exception {
        TrackAnswer answer = TrackAnswer.parse("{\"ok\":true,\"startIndex\":1,\"startPositionMs\":120000,\"tracks\":["
                + "{\"id\":\"plex:11\",\"url\":\"https://kiosk.example/s/11\",\"title\":\"One\",\"durationMs\":100000},"
                + "{\"id\":\"plex:12\",\"url\":\"https://kiosk.example/s/12\",\"title\":\"Two\",\"artist\":\"A\",\"album\":\"B\","
                + "\"artUrl\":\"https://kiosk.example/t/12\",\"listId\":\"list-9\",\"durationMs\":100000}]}");
        assertEquals(2, answer.tracks.size());
        assertEquals(1, answer.startIndex);
        assertEquals(120_000, answer.startPositionMs);
        TrackAnswer.Track two = answer.tracks.get(1);
        assertEquals("plex:12", two.id);
        assertFalse("music unless the payload says long-form", two.longForm);
        assertTrue(TrackAnswer.parse("{\"ok\":true,\"tracks\":[{\"id\":\"plex:21\",\"url\":\"https://kiosk.example/s/21\","
                + "\"title\":\"Chapter 1\",\"durationMs\":480000,\"longForm\":true}]}").tracks.get(0).longForm);
        assertEquals("https://kiosk.example/s/12", two.url);
        assertEquals("A", two.artist);
        assertEquals("B", two.album);
        assertEquals("list-9", two.listId);
        assertEquals(100_000, two.durationMs);
        assertEquals("https://kiosk.example/t/12", two.artUrl);
    }

    @Test public void aTrackWithoutAWebStreamIsLeftOutAndTheStartIsKeptInRange() throws Exception {
        TrackAnswer answer = TrackAnswer.parse("{\"ok\":true,\"startIndex\":7,\"startPositionMs\":-5,\"tracks\":["
                + "{\"id\":\"plex:11\",\"url\":\"file:///sdcard/a.mp3\",\"title\":\"One\"},"
                + "{\"id\":\"plex:12\",\"url\":\"content://other.app/a\",\"title\":\"Two\"},"
                + "{\"id\":\"\",\"url\":\"https://kiosk.example/s/13\",\"title\":\"Three\"},"
                + "{\"id\":\"plex:14\",\"url\":\"https://kiosk.example/s/14\",\"title\":\"Four\"}]}");
        assertEquals(1, answer.tracks.size());
        assertEquals("plex:14", answer.tracks.get(0).id);
        assertEquals(0, answer.tracks.get(0).durationMs);
        assertEquals(0, answer.startIndex);
        assertEquals(0, answer.startPositionMs);
        try { TrackAnswer.parse("{\"ok\":true,\"tracks\":[]}"); fail("an empty queue is not something to play"); }
        catch (BrowseAnswer.Failed expected) { }
    }
}
