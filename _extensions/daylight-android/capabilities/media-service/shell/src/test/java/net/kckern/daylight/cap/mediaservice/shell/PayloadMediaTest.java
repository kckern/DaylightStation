package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class PayloadMediaTest {
    private final List<String> seen = new ArrayList<>();
    private PayloadPort.Handler handler;

    private void attach(final String answer) {
        handler = request -> { seen.add(request); return answer; };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
    }

    @After public void tearDown() {
        if (handler != null) PayloadPort.named(PayloadMedia.PORT).detach(handler);
    }

    /** The payload's capability attaches to a port of this name (MediaServiceCapability.PORT). */
    @Test public void thePortIsTheOneThePayloadServes() {
        assertEquals("media", PayloadMedia.PORT);
    }

    @Test public void theThreeRequestsAreWhatThePayloadReads() throws Exception {
        attach("{\"ok\":true}");
        PayloadMedia media = new PayloadMedia();
        media.browse("c:plex:9", 2, 50, 0);
        JSONObject browse = new JSONObject(seen.get(0));
        assertEquals("browse", browse.getString("op"));
        assertEquals("c:plex:9", browse.getString("parent"));
        assertEquals(2, browse.getInt("page"));

        media.resolve(Arrays.asList("p:plex:11|plex:9", "c:plex:10"), -1, false, 0);
        JSONObject resolve = new JSONObject(seen.get(1));
        assertEquals("resolve", resolve.getString("op"));
        assertEquals("c:plex:10", resolve.getJSONArray("ids").getString(1));

        media.event("plex:11", "So What", "list-9", 30_000, 300_000, "playing");
        JSONObject event = new JSONObject(seen.get(2));
        assertEquals("event", event.getString("op"));
        assertEquals("plex:11", event.getString("id"));
        assertEquals(30_000, event.getLong("positionMs"));
        assertEquals(300_000, event.getLong("durationMs"));
        assertEquals("playing", event.getString("state"));
        assertEquals("list-9", event.getString("listId"));
    }

    @Test public void withNoPayloadABrowseSaysSoAndAnEventIsDropped() throws Exception {
        PayloadMedia media = new PayloadMedia();
        try { media.browse("root", 0, 50, 0); fail("answered with no payload"); }
        catch (PayloadPort.NotReadyException expected) { }
        assertFalse("an event with nobody to take it is dropped, and nothing is thrown",
                media.event("plex:11", "So What", "", 30_000, 300_000, "playing"));
        assertFalse(media.awaitReady(0));
    }

    @Test public void aPayloadThatThrowsIsAFailedCallAndNotACrash() throws Exception {
        handler = request -> { throw new IllegalStateException("swapped out"); };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        PayloadMedia media = new PayloadMedia();
        assertFalse(media.event("plex:11", "So What", "", 30_000, 300_000, "playing"));
        try { media.browse("root", 0, 50, 0); fail(); } catch (IllegalStateException expected) { }
        assertTrue(media.awaitReady(0));
    }
}
