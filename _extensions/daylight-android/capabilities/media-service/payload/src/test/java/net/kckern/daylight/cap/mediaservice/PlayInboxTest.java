package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** "Play on phone": a command becomes a play here, and every command is acknowledged. */
public class PlayInboxTest {
    private final List<String> posts = new ArrayList<>();
    private final List<String> played = new ArrayList<>();

    private PlayInbox inbox(boolean playerThere) {
        Http http = new Http() {
            @Override public Reply get(String url) { return new Reply(204, ""); }
            @Override public Reply postJson(String url, String json) { posts.add(url + " " + json); return new Reply(204, ""); }
            @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) { throw new AssertionError(); }
        };
        return new PlayInbox(http, path -> "https://home.example" + path, "phone", id -> {
            if (!playerThere) throw new IllegalStateException("no player");
            played.add(id);
        });
    }

    @Test public void theWebsQueueEnvelopeStartsThroughTheQueueRoute() throws Exception {
        // As the backend's phone-inbox hands it over: the screen's queue envelope.
        JSONObject envelope = new JSONObject().put("commandId", "d-9").put("command", "queue").put("targetDevice", "phone")
                .put("params", new JSONObject().put("op", "play-now").put("contentId", "plex:352336"));
        assertEquals("c:plex:352336", PlayInbox.mediaIdOf(envelope));
        assertEquals("c:plex:727120", PlayInbox.mediaIdOf(new JSONObject().put("contentId", "plex:727120")));
        assertNull(PlayInbox.mediaIdOf(new JSONObject().put("params", new JSONObject().put("contentId", "../etc"))));
    }

    @Test public void aCommandPlaysHereAndIsAcknowledged() throws Exception {
        inbox(true).handle(new JSONObject().put("commandId", "d-1").put("command", "queue")
                .put("params", new JSONObject().put("op", "play-now").put("contentId", "plex:727120")));
        assertEquals(List.of("c:plex:727120"), played);
        assertTrue(posts.get(0).startsWith("https://home.example/api/v1/device/phone/ack {"));
        JSONObject ack = new JSONObject(posts.get(0).substring(posts.get(0).indexOf('{')));
        assertEquals("d-1", ack.getString("commandId"));
        assertTrue(ack.getBoolean("ok"));
        assertEquals("plex:727120", ack.getJSONObject("state").getString("contentId"));
    }

    @Test public void aRefusedCommandIsAcknowledgedAsRefused() throws Exception {
        inbox(false).handle(new JSONObject().put("commandId", "d-2").put("op", "play").put("contentId", "plex:1"));
        JSONObject ack = new JSONObject(posts.get(0).substring(posts.get(0).indexOf('{')));
        assertFalse(ack.getBoolean("ok"));
        assertEquals("could_not_play", ack.getString("error"));
        inbox(true).handle(new JSONObject().put("commandId", "d-3").put("op", "seek"));
        JSONObject unsupported = new JSONObject(posts.get(1).substring(posts.get(1).indexOf('{')));
        assertEquals("unsupported", unsupported.getString("error"));
    }
}
