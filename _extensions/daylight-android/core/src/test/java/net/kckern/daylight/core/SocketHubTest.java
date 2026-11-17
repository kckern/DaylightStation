package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public class SocketHubTest {
    private static final class FakeClient implements SocketHub.Client {
        final List<String> sent = new ArrayList<>();
        boolean broken, closed;
        int pings;
        @Override public void send(String text) throws IOException { if (broken) throw new IOException("gone"); sent.add(text); }
        @Override public void ping() throws IOException { if (broken) throw new IOException("gone"); pings++; }
        @Override public void close() { closed = true; }
        JSONObject last() throws Exception { return new JSONObject(sent.get(sent.size() - 1)); }
    }

    private StatusBoard board;
    private SocketHub hub;
    private FakeClient client;

    @Before public void setUp() {
        board = new StatusBoard();
        hub = new SocketHub("test", board);
        client = new FakeClient();
        hub.opened(client);
    }

    @Test public void greetsANewClient() throws Exception {
        assertEquals("ready", client.last().getString("type"));
        assertEquals("test", client.last().getString("device"));
        assertEquals(1, hub.clients());
    }

    @Test public void routesAMessageToItsHandler() throws Exception {
        List<Integer> notes = new ArrayList<>();
        hub.on("note.on", (message, reply) -> notes.add(message.getInt("note")));
        hub.message(client, "{\"type\":\"note.on\",\"note\":60}");
        assertEquals(java.util.Arrays.asList(60), notes);
    }

    @Test public void anUnknownTypeBadJsonAndAFailingHandlerEachAnswerWithAnError() throws Exception {
        hub.on("boom", (message, reply) -> { throw new IllegalStateException("kaput"); });
        hub.message(client, "{\"type\":\"nope\"}");
        assertEquals("unknown_type", client.last().getString("code"));
        hub.message(client, "{not json");
        assertEquals("bad_json", client.last().getString("code"));
        hub.message(client, "{\"type\":\"boom\"}");
        assertEquals("dispatch_failed", client.last().getString("code"));
        assertEquals("error", client.last().getString("type"));
    }

    @Test public void aHandlerCanAnswerWithItsOwnError() throws Exception {
        hub.on("preset.load", (message, reply) -> reply.error("no_spec", "preset.load missing spec"));
        hub.message(client, "{\"type\":\"preset.load\"}");
        assertEquals("no_spec", client.last().getString("code"));
        assertEquals("preset.load missing spec", client.last().getString("msg"));
    }

    @Test public void theTextPingIsAnsweredWithPong() throws Exception {
        hub.message(client, "ping");
        assertEquals("pong", client.last().getString("type"));
    }

    @Test(expected = IllegalStateException.class)
    public void aMessageTypeBelongsToOneCapability() {
        hub.on("panic", (m, r) -> { });
        hub.on("panic", (m, r) -> { });
    }

    @Test public void broadcastDropsAClientThatFails() {
        FakeClient dead = new FakeClient();
        hub.opened(dead);
        dead.broken = true;
        hub.broadcast("{\"type\":\"note.on\"}");
        assertEquals(1, hub.clients());
        assertTrue(client.sent.contains("{\"type\":\"note.on\"}"));
    }

    @Test public void theStatusFrameIsSentOnlyWhenSomethingContributesToIt() throws Exception {
        int before = client.sent.size();
        hub.tick();
        assertEquals("a device with no frame contributor sends no status frames", before, client.sent.size());
        board.add(StatusBoard.Surface.FRAME, "synth", o -> o.put("engine", "running"));
        hub.tick();
        assertEquals("status", client.last().getString("type"));
        assertEquals("running", client.last().getString("engine"));
    }

    @Test public void everyThirdTickPingsAndCloseClientsClosesThem() {
        hub.tick(); hub.tick(); hub.tick();
        assertEquals(1, client.pings);
        hub.closeClients();
        assertTrue(client.closed);
        assertEquals(0, hub.clients());
    }
}
