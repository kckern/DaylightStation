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

    @Before public void setUp() throws Exception {
        board = new StatusBoard();
        hub = new SocketHub("test", board);
        client = new FakeClient();
        hub.opened(client);
    }

    @Test public void greetsANewClient() throws Exception {
        hub.awaitDelivered(2000);
        assertEquals("ready", client.last().getString("type"));
        hub.awaitDelivered(2000);
        assertEquals("test", client.last().getString("device"));
        hub.awaitDelivered(2000);
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
        hub.awaitDelivered(2000);
        assertEquals("unknown_type", client.last().getString("code"));
        hub.message(client, "{not json");
        hub.awaitDelivered(2000);
        assertEquals("bad_json", client.last().getString("code"));
        hub.message(client, "{\"type\":\"boom\"}");
        hub.awaitDelivered(2000);
        assertEquals("dispatch_failed", client.last().getString("code"));
        hub.awaitDelivered(2000);
        assertEquals("error", client.last().getString("type"));
    }

    @Test public void aHandlerCanAnswerWithItsOwnError() throws Exception {
        hub.on("preset.load", (message, reply) -> reply.error("no_spec", "preset.load missing spec"));
        hub.message(client, "{\"type\":\"preset.load\"}");
        hub.awaitDelivered(2000);
        assertEquals("no_spec", client.last().getString("code"));
        hub.awaitDelivered(2000);
        assertEquals("preset.load missing spec", client.last().getString("msg"));
    }

    @Test public void theTextPingIsAnsweredWithPong() throws Exception {
        hub.message(client, "ping");
        hub.awaitDelivered(2000);
        assertEquals("pong", client.last().getString("type"));
    }

    @Test(expected = IllegalStateException.class)
    public void aMessageTypeBelongsToOneCapability() {
        hub.on("panic", (m, r) -> { });
        hub.on("panic", (m, r) -> { });
    }

    @Test public void broadcastDropsAClientThatFails() throws Exception {
        FakeClient dead = new FakeClient();
        hub.opened(dead);
        dead.broken = true;
        hub.broadcast("{\"type\":\"note.on\"}");
        hub.awaitDelivered(2000);
        assertEquals(1, hub.clients());
        hub.awaitDelivered(2000);
        assertTrue(client.sent.contains("{\"type\":\"note.on\"}"));
    }

    @Test public void theStatusFrameIsSentOnlyWhenSomethingContributesToIt() throws Exception {
        hub.awaitDelivered(2000);
        int before = client.sent.size();
        hub.tick();
        hub.awaitDelivered(2000);
        assertEquals("a device with no frame contributor sends no status frames", before, client.sent.size());
        board.add(StatusBoard.Surface.FRAME, "synth", o -> o.put("engine", "running"));
        hub.tick();
        hub.awaitDelivered(2000);
        assertEquals("status", client.last().getString("type"));
        hub.awaitDelivered(2000);
        assertEquals("running", client.last().getString("engine"));
    }

    @Test public void everyThirdTickPingsAndCloseClientsClosesThem() throws Exception {
        hub.tick(); hub.tick(); hub.tick();
        hub.awaitDelivered(2000);
        assertEquals(1, client.pings);
        hub.closeClients();
        assertTrue(client.closed);
        hub.awaitDelivered(2000);
        assertEquals(0, hub.clients());
    }

    @Test public void aHandlerLinkageErrorAnswersWithAnErrorInsteadOfKillingTheSocketThread() throws Exception {
        hub.on("missing", (message, reply) -> { throw new NoSuchMethodError("Thing.gone()"); });
        hub.message(client, "{\"type\":\"missing\"}");
        hub.awaitDelivered(2000);
        assertEquals("dispatch_failed", client.last().getString("code"));
    }

    // ── a client that stops reading ─────────────────────────────────────────

    /** A socket whose peer does not read: send() blocks until the connection is cut. */
    private static final class StuckClient implements SocketHub.Client {
        final java.util.concurrent.CountDownLatch cut = new java.util.concurrent.CountDownLatch(1);
        final java.util.concurrent.atomic.AtomicInteger sendsStarted = new java.util.concurrent.atomic.AtomicInteger();
        volatile boolean politeClose;
        @Override public void send(String text) throws IOException {
            sendsStarted.incrementAndGet();
            try { cut.await(); } catch (InterruptedException ignored) { }
            throw new IOException("connection reset");
        }
        @Override public void ping() throws IOException { send("ping"); }
        @Override public void close() { politeClose = true; }     // would itself block behind the stuck write
        @Override public void abort() { cut.countDown(); }
    }

    private static int outThreads() {
        int n = 0;
        for (Thread t : Thread.getAllStackTraces().keySet()) if (t.isAlive() && "Daylight-ws-out".equals(t.getName())) n++;
        return n;
    }

    @org.junit.After public void tearDown() { hub.stop(); }

    @Test(timeout = 20000) public void aClientThatNeverReadsDoesNotBlockTheBroadcasterAndIsCutOff() throws Exception {
        hub.awaitDelivered(2000);
        client.sent.clear();
        StuckClient stuck = new StuckClient();
        hub.opened(stuck);
        int frames = SocketHub.MAX_QUEUED + 100;
        long slowest = 0;
        for (int i = 0; i < frames; i++) {
            long t0 = System.nanoTime();
            hub.broadcast("{\"type\":\"note.on\",\"note\":" + i + "}");
            slowest = Math.max(slowest, System.nanoTime() - t0);
            if (i % 100 == 0) hub.awaitDelivered(50);      // let the healthy client drain, as a reading peer does
        }
        assertTrue("no broadcast waited on the stuck client (slowest " + slowest / 1_000_000 + " ms)", slowest < 500_000_000L);
        assertTrue("its connection was cut, not politely closed", stuck.cut.await(5, java.util.concurrent.TimeUnit.SECONDS));
        assertFalse(stuck.politeClose);
        assertEquals("the write that was in flight is the only one it ever started", 1, stuck.sendsStarted.get());
        assertTrue(hub.awaitDelivered(5000));
        assertEquals(1, hub.clients());
        assertEquals("the healthy client missed nothing", frames, client.sent.size());
        for (int i = 0; i < frames; i++) {
            assertEquals("in the order broadcast", i, new JSONObject(client.sent.get(i)).getInt("note"));
        }
    }

    @Test(timeout = 20000) public void repliesAndBroadcastsReachAClientInTheOrderTheyWereMade() throws Exception {
        hub.awaitDelivered(2000);
        client.sent.clear();
        hub.on("ask", (message, reply) -> reply.send(new JSONObject().put("type", "answer").put("n", message.getInt("n"))));
        for (int i = 0; i < 200; i++) {
            if (i % 2 == 0) hub.broadcast("{\"type\":\"answer\",\"n\":" + i + "}");
            else hub.message(client, "{\"type\":\"ask\",\"n\":" + i + "}");
        }
        assertTrue(hub.awaitDelivered(5000));
        assertEquals(200, client.sent.size());
        for (int i = 0; i < 200; i++) assertEquals(i, new JSONObject(client.sent.get(i)).getInt("n"));
    }

    @Test(timeout = 20000) public void stopEndsEveryClientsSenderEvenAStuckOne() throws Exception {
        int before = outThreads();          // this hub's first client, and whatever other tests left
        StuckClient stuck = new StuckClient();
        hub.opened(stuck);
        hub.broadcast("{\"type\":\"status\"}");
        long deadline = System.currentTimeMillis() + 2000;
        while (stuck.sendsStarted.get() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(5);
        hub.stop();
        assertTrue("a client in the middle of a blocked write is cut", stuck.cut.await(2, java.util.concurrent.TimeUnit.SECONDS));
        assertTrue("an idle client is closed politely", client.closed);
        assertEquals(0, hub.clients());
        deadline = System.currentTimeMillis() + 3000;
        while (outThreads() > before - 1 && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals("neither client's sender thread outlives stop", before - 1, outThreads());
    }
}
