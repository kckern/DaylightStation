package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.testing.TestCore;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.Arrays;
import java.util.Collections;

public class ResolverTest {
    private static final String ALBUM = "{\"items\":["
            + "{\"contentId\":\"plex:11\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/11\",\"duration\":100},"
            + "{\"contentId\":\"plex:12\",\"title\":\"Two\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/12\",\"duration\":100}]}";
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private Backend backend;
    private final FakeMediaApi api = new FakeMediaApi();

    @Before public void setUp() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        api.responses.put("queue plex:10", ALBUM);
    }

    private Resolver.Resolved resolve(String... ids) throws Exception {
        return Resolver.resolve(Arrays.asList(ids), -1, false, api, backend, "s");
    }

    @Test public void aContainerResolvesToItsWholeQueue() throws Exception {
        Resolver.Resolved r = resolve("c:plex:10");
        assertEquals(2, r.tracks.size());
        assertEquals(0, r.startIndex);
        assertEquals(0, r.startPositionMs);
        assertEquals("a later page of a container is still that container", 2, resolve("m:50|plex:10").tracks.size());
    }

    @Test public void aLeafInAContainerQueuesTheContainerAndStartsAtTheLeaf() throws Exception {
        Resolver.Resolved r = resolve("p:plex:12|plex:10");
        assertEquals(2, r.tracks.size());
        assertEquals(1, r.startIndex);
        assertEquals(Collections.singletonList("queue plex:10"), api.calls);
    }

    @Test public void aLeafInAnAudiobookResumesWhereTheBackendSays() throws Exception {
        api.responses.put("queue abs:1", "{\"items\":["
                + "{\"contentId\":\"abs:1/a\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/a\",\"duration\":1000},"
                + "{\"contentId\":\"abs:1/b\",\"title\":\"Two\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/b\",\"duration\":1000,\"resumable\":true,\"resumePosition\":250}]}");
        Resolver.Resolved r = resolve("p:abs:1/b|abs:1");
        assertEquals(1, r.startIndex);
        assertEquals(250_000, r.startPositionMs);
    }

    @Test public void aLeafThatIsNotInItsContainersQueuePlaysAlone() throws Exception {
        api.responses.put("play plex:99", "{\"id\":\"plex:99\",\"title\":\"Loose\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/99\",\"duration\":60}");
        Resolver.Resolved r = resolve("p:plex:99|plex:10");
        assertEquals(1, r.tracks.size());
        assertEquals("plex:99", r.tracks.get(0).id);
    }

    @Test public void aLoneLeafResolvesThroughPlayAndResumes() throws Exception {
        api.responses.put("play abs:7", "{\"id\":\"abs:7\",\"title\":\"Chapter\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/7\",\"duration\":3600,"
                + "\"resumable\":true,\"resume_position\":120}");
        Resolver.Resolved r = resolve("p:abs:7");
        assertEquals(1, r.tracks.size());
        assertEquals(120_000, r.startPositionMs);
    }

    /** The play route answers a container with its first playable item; the id in the answer then differs. */
    @Test public void aLoneIdThatTurnsOutToBeAContainerIsQueuedWhole() throws Exception {
        api.responses.put("play plex:10", "{\"id\":\"plex:11\",\"title\":\"One\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/11\",\"duration\":100}");
        Resolver.Resolved r = resolve("p:plex:10");
        assertEquals(2, r.tracks.size());
        assertEquals(Arrays.asList("play plex:10", "queue plex:10"), api.calls);
    }

    @Test public void severalIdsAreQueuedInOrder() throws Exception {
        api.responses.put("play plex:99", "{\"id\":\"plex:99\",\"title\":\"Loose\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/99\",\"duration\":60,\"resume_position\":30,\"resumable\":true}");
        Resolver.Resolved r = resolve("p:plex:99", "c:plex:10");
        assertEquals(3, r.tracks.size());
        assertEquals("plex:99", r.tracks.get(0).id);
        assertEquals("a resume point belongs to a single request", 0, r.startPositionMs);
    }

    @Test public void theSelectedInputStartsAfterEarlierExpandedTracks() throws Exception {
        api.responses.put("play plex:99", "{\"id\":\"plex:99\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/99\","
                + "\"duration\":60,\"resume_position\":30,\"resumable\":true}");
        Resolver.Resolved r = Resolver.resolve(Arrays.asList("c:plex:10", "p:plex:99"), 1, false, api, backend, "s");
        assertEquals(2, r.startIndex);
        assertEquals("plex:99", r.tracks.get(r.startIndex).id);
        assertEquals(0, r.startPositionMs);
    }

    @Test public void videoOrAnUnknownIdIsRefusedWithAReason() throws Exception {
        api.responses.put("play plex:20", "{\"id\":\"plex:20\",\"mediaType\":\"dash_video\",\"mediaUrl\":\"/s/20\"}");
        try { resolve("p:plex:20"); fail(); }
        catch (IllegalArgumentException e) { assertEquals("nothing here plays as audio", e.getMessage()); }
        for (String bad : new String[] { "x:plex:20", "root", "recent", "catalog", "https://evil.example/a.mp3", null }) {
            try { resolve(bad); fail("accepted " + bad); }
            catch (IllegalArgumentException e) { assertEquals("unknown media id", e.getMessage()); }
        }
        try { resolve(); fail(); } catch (IllegalArgumentException e) { assertEquals("unknown media id", e.getMessage()); }
    }

    @Test public void anIdTheBackendDoesNotKnowIsRefusedAndNothingIsPlayed() throws Exception {
        try { resolve("p:plex:404"); fail(); }
        catch (MediaApi.Refused e) { assertEquals(404, e.status); }
    }

    @Test public void aRequestIsBoundedInIdsAndInTracks() throws Exception {
        String[] many = new String[Resolver.MAX_IDS + 1];
        Arrays.fill(many, "c:plex:10");
        try { resolve(many); fail(); } catch (IllegalArgumentException e) { assertEquals("too many media ids", e.getMessage()); }

        StringBuilder big = new StringBuilder("{\"items\":[");
        for (int i = 0; i < Resolver.MAX_TRACKS + 50; i++) {
            if (i > 0) big.append(',');
            big.append("{\"contentId\":\"plex:").append(1000 + i).append("\",\"title\":\"T\",\"mediaType\":\"audio\",\"mediaUrl\":\"/s/").append(i).append("\"}");
        }
        api.responses.put("queue plex:77", big.append("]}").toString());
        assertEquals(Resolver.MAX_TRACKS, resolve("c:plex:77").tracks.size());
        Resolver.Resolved selected = Resolver.resolve(Arrays.asList("c:plex:77", "c:plex:10"), 1, false, api, backend, "s");
        assertEquals(Resolver.MAX_TRACKS, selected.tracks.size());
        assertEquals("plex:11", selected.tracks.get(selected.startIndex).id);
        assertEquals("the item that was asked for is kept when the queue is cut", "plex:" + (1000 + Resolver.MAX_TRACKS + 10),
                resolve("p:plex:" + (1000 + Resolver.MAX_TRACKS + 10) + "|plex:77").tracks
                        .get(resolve("p:plex:" + (1000 + Resolver.MAX_TRACKS + 10) + "|plex:77").startIndex).id);
    }
}
