package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;

public class QueueMapperTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private Backend backend;

    @Before public void setUp() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
    }

    @Test public void mapsAudioItemsAndLeavesVideoOut() throws Exception {
        JSONObject response = new JSONObject("{\"count\":2,\"items\":["
                + "{\"id\":\"plex:11\",\"contentId\":\"plex:11\",\"title\":\"So What\",\"mediaUrl\":\"/api/v1/proxy/plex/stream/11\","
                + "\"mediaType\":\"audio\",\"duration\":545,\"thumbnail\":\"/api/v1/proxy/plex/thumb/11\","
                + "\"artist\":\"Miles Davis\",\"album\":\"Kind of Blue\",\"listId\":null},"
                + "{\"id\":\"plex:20\",\"contentId\":\"plex:20\",\"title\":\"A film\",\"mediaUrl\":\"/api/v1/proxy/plex/stream/20\",\"mediaType\":\"dash_video\"}]}");
        List<Track> tracks = QueueMapper.fromQueue(response, backend, "daylight-phone");
        assertEquals(1, tracks.size());
        Track t = tracks.get(0);
        assertEquals("plex:11", t.id);
        assertEquals("the Plex stream URL names a session, as the web player's does",
                "https://kiosk.example/api/v1/proxy/plex/stream/11?session=daylight-phone", t.url);
        assertEquals(545_000, t.durationMs);
        assertEquals("Miles Davis", t.artist);
        assertEquals("Kind of Blue", t.album);
        assertEquals("", t.listId);
        assertEquals("https://kiosk.example/api/v1/proxy/plex/thumb/11", t.artUrl);
    }

    @Test public void aNonPlexStreamIsLeftAsItIs() throws Exception {
        JSONObject item = new JSONObject("{\"contentId\":\"readalong:talks/1\",\"title\":\"A talk\",\"mediaType\":\"audio\","
                + "\"mediaUrl\":\"/api/v1/stream/readalong/talks/1.mp3\",\"duration\":61.5}");
        Track t = QueueMapper.fromItem(item, backend, "daylight-phone");
        assertEquals("https://kiosk.example/api/v1/stream/readalong/talks/1.mp3", t.url);
        assertEquals(61_500, t.durationMs);
    }

    /** A play response has no top-level artist or album: they are the parent titles, or in its metadata. */
    @Test public void aPlayResponseUsesItsOwnFieldNames() throws Exception {
        JSONObject play = new JSONObject("{\"id\":\"plex:11\",\"assetId\":\"plex:11\",\"title\":\"So What\",\"mediaType\":\"audio\","
                + "\"mediaUrl\":\"/api/v1/proxy/plex/stream/11?session=x\",\"duration\":545,\"grandparentTitle\":\"Miles Davis\",\"parentTitle\":\"Kind of Blue\"}");
        Track t = QueueMapper.fromItem(play, backend, "s");
        assertEquals("plex:11", t.id);
        assertEquals("Miles Davis", t.artist);
        assertEquals("Kind of Blue", t.album);
        assertEquals("a session the backend already put there is not added twice",
                "https://kiosk.example/api/v1/proxy/plex/stream/11?session=x", t.url);

        JSONObject book = new JSONObject("{\"id\":\"abs:7\",\"title\":\"Chapter\",\"mediaType\":\"audio\",\"mediaUrl\":\"/api/v1/proxy/abs/items/7/play\","
                + "\"metadata\":{\"author\":\"An Author\",\"artist\":\"A Narrator\",\"album\":\"A Book\"}}");
        assertEquals("A Narrator", QueueMapper.fromItem(book, backend, "s").artist);
        assertEquals("A Book", QueueMapper.fromItem(book, backend, "s").album);
    }

    @Test public void anItemWithNoUrlOrAUrlOnAnotherHostIsNotPlayable() throws Exception {
        assertNull(QueueMapper.fromItem(new JSONObject("{\"contentId\":\"x:1\",\"mediaType\":\"audio\",\"mediaUrl\":null}"), backend, "s"));
        assertNull(QueueMapper.fromItem(new JSONObject("{\"contentId\":\"x:1\",\"mediaType\":\"audio\",\"mediaUrl\":\"http://evil.example/a.mp3\"}"), backend, "s"));
        assertNull(QueueMapper.fromItem(new JSONObject("{\"contentId\":\"x:1\",\"mediaType\":\"audio\",\"mediaUrl\":\"https://kiosk.example.evil.example/a.mp3\"}"), backend, "s"));
        assertNull(QueueMapper.fromItem(new JSONObject("{\"contentId\":\"x:1\",\"mediaType\":\"audio\",\"mediaUrl\":\"//evil.example/a.mp3\"}"), backend, "s"));
        assertNull("an id that is not a content id cannot be reported on", QueueMapper.fromItem(
                new JSONObject("{\"contentId\":\"nope\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/1\"}"), backend, "s"));
        assertNull(QueueMapper.fromItem(new JSONObject("{\"contentId\":\"youtube:a\",\"mediaType\":\"webview\",\"mediaUrl\":\"https://video.example/embed/a\"}"), backend, "s"));
        assertNull(QueueMapper.fromItem(null, backend, "s"));
        assertTrue(QueueMapper.fromQueue(new JSONObject("{\"items\":[null,3,{}]}"), backend, "s").isEmpty());
        assertTrue(QueueMapper.fromQueue(new JSONObject("{}"), backend, "s").isEmpty());
    }

    @Test public void whereToResumeComesFromTheBackend() throws Exception {
        assertEquals("a play response says resume_position, in seconds", 120_000,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"duration\":3600,\"resumable\":true,\"resume_position\":120}")));
        assertEquals("a queue item says resumePosition", 90_000,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"duration\":3600,\"resumable\":true,\"resumePosition\":90}")));
        assertEquals("a queue item that is not resumable starts at the beginning", 0,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"duration\":3600,\"resumable\":false,\"resumePosition\":90}")));
        assertEquals("a Plex stream is sought by the player, offset= or not: its clock stays true", 120_000,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/api/v1/proxy/plex/stream/7?offset=120\",\"duration\":3600,\"resume_position\":120}")));
        assertEquals("another stream that starts at its offset is not sought again", 0,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7?offset=120\",\"duration\":3600,\"resume_position\":120}")));
        assertEquals("/api/v1/proxy/plex/stream/7?session=a", QueueMapper.withoutParam("/api/v1/proxy/plex/stream/7?offset=120&session=a", "offset"));
        assertEquals("/api/v1/proxy/plex/stream/7", QueueMapper.withoutParam("/api/v1/proxy/plex/stream/7?offset=120", "offset"));
        assertEquals("a position at or past the end is not one to resume at", 0,
                QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"duration\":100,\"resume_position\":100}")));
        assertEquals(0, QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"resume_position\":\"soon\"}")));
        assertEquals(0, QueueMapper.resumeMs(new JSONObject("{\"mediaUrl\":\"/s/7\",\"resume_position\":-4}")));
    }
}
