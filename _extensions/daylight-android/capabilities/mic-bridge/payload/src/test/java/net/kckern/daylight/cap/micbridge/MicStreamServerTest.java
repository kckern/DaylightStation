package net.kckern.daylight.cap.micbridge;

import static org.junit.Assert.*;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.junit.After;
import org.junit.Test;

import java.net.ServerSocket;
import java.net.URI;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The socket side of the stream, on the JVM. android.jar's stubs return defaults here,
 * so an AudioRecord never initializes: that is the "capture would not start" case.
 */
public class MicStreamServerTest {
    private MicStreamServer server;

    @After public void tearDown() { if (server != null) server.stop(); }

    private static int freePort() throws Exception {
        try (ServerSocket s = new ServerSocket(0)) { return s.getLocalPort(); }
    }

    @Test public void itListensOnLoopbackOnlyAndStopsTwice() throws Exception {
        int port = freePort();
        server = new MicStreamServer(null);
        assertFalse(server.running());
        server.start(port);
        assertTrue(server.running());
        assertEquals(port, server.port());
        assertTrue("the microphone is never offered to the network", server.boundAddress().getAddress().isLoopbackAddress());
        assertEquals(0, server.clients());
        assertFalse(server.streaming());
        assertFalse(server.captureDenied());
        assertNull(server.lastError());
        server.stop();
        assertFalse(server.running());
        server.stop();
    }

    @Test public void aPortThatIsTakenIsNotRunningAndSaysWhy() throws Exception {
        try (ServerSocket taken = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            server = new MicStreamServer(null);
            server.start(taken.getLocalPort());
            assertFalse(server.running());
            assertNotNull(server.lastError());
            assertFalse("a port clash is not another app holding the microphone", server.captureDenied());
        }
    }

    @Test public void captureThatWillNotStartIsReportedAsHeldByAnother() throws Exception {
        int port = freePort();
        server = new MicStreamServer(null);
        server.start(port);
        final List<String> texts = new CopyOnWriteArrayList<>();
        final CountDownLatch closed = new CountDownLatch(1);
        WebSocketClient client = new WebSocketClient(new URI("ws://127.0.0.1:" + port)) {
            @Override public void onOpen(ServerHandshake h) { }
            @Override public void onMessage(String message) { texts.add(message); }
            @Override public void onClose(int code, String reason, boolean remote) { closed.countDown(); }
            @Override public void onError(Exception ex) { }
        };
        assertTrue(client.connectBlocking(5, TimeUnit.SECONDS));
        // Four attempts with 0.5 s, 1 s and 2 s between them, then the server gives up.
        assertTrue("the server closes a client it cannot capture for", closed.await(15, TimeUnit.SECONDS));
        assertEquals("{\"sampleRate\":48000,\"channels\":1,\"format\":\"pcm_s16le\"}", texts.get(0));
        assertEquals("{\"error\":\"AudioRecord failed to initialize\"}", texts.get(1));
        assertTrue(server.captureDenied());
        assertEquals("AudioRecord failed to initialize", server.lastError());
        assertFalse(server.streaming());
        assertTrue("the server keeps listening for the next client", server.running());
    }
}
