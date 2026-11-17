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

    // ── who may connect ─────────────────────────────────────────────────────

    private static final String START = "https://kiosk.example/tv";

    @Test public void aPageFromTheStartUrlsOriginIsAdmitted() {
        assertTrue(MicOriginRule.admits("https://kiosk.example", START, true, false));
        assertTrue(MicOriginRule.admits("https://KIOSK.example:443", START, true, false));
        assertTrue(MicOriginRule.admits("http://kiosk.example", "http://kiosk.example:80/", true, false));
    }

    @Test public void aPageFromAnyOtherOriginIsRefused() {
        assertFalse(MicOriginRule.admits("https://other.example", START, true, true));
        assertFalse("the scheme is part of the origin", MicOriginRule.admits("http://kiosk.example", START, true, true));
        assertFalse("so is the port", MicOriginRule.admits("https://kiosk.example:8443", START, true, true));
        assertFalse(MicOriginRule.admits("https://kiosk.example.evil.example", START, true, true));
        assertFalse("an opaque origin", MicOriginRule.admits("null", START, true, true));
        assertFalse(MicOriginRule.admits("file://", START, true, true));
    }

    @Test public void anOriginIsRefusedWhenTheDeviceHasNoStartUrl() {
        assertFalse(MicOriginRule.admits("https://kiosk.example", "", true, true));
        assertFalse(MicOriginRule.admits("https://kiosk.example", null, true, true));
        assertFalse(MicOriginRule.admits("https://kiosk.example", "not a url", true, true));
    }

    @Test public void noOriginIsAdmittedOnlyFromLoopbackAndOnlyWhileTheSettingAllowsIt() {
        assertTrue(MicOriginRule.admits(null, START, true, true));
        assertTrue(MicOriginRule.admits("", "", true, true));
        assertFalse(MicOriginRule.admits(null, START, true, false));
        assertFalse(MicOriginRule.admits(null, START, false, true));
    }

    private boolean connects(int port, String origin) throws Exception {
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        if (origin != null) headers.put("Origin", origin);
        WebSocketClient client = new WebSocketClient(new URI("ws://127.0.0.1:" + port), headers) {
            @Override public void onOpen(ServerHandshake h) { }
            @Override public void onMessage(String message) { }
            @Override public void onClose(int code, String reason, boolean remote) { }
            @Override public void onError(Exception ex) { }
        };
        boolean open = client.connectBlocking(5, TimeUnit.SECONDS);
        client.closeBlocking();
        return open;
    }

    @Test public void theHandshakeAppliesTheRule() throws Exception {
        int port = freePort();
        server = new MicStreamServer(null, new CaptureState(),
                (origin, loopback) -> MicOriginRule.admits(origin, START, loopback, false));
        server.start(port);
        assertFalse("another site's page", connects(port, "https://other.example"));
        assertFalse("no Origin, and the setting is off", connects(port, null));
        assertEquals(2, server.refusedHandshakes());
        assertEquals("a refused client never becomes a connection", 0, server.clients());
        assertTrue("the kiosk's own page", connects(port, "https://kiosk.example"));
        assertEquals(2, server.refusedHandshakes());
    }

    // ── a microphone that does open ─────────────────────────────────────────

    /** An AudioRecord that initializes and records silence, and remembers being released. */
    private static final class FakeRecord extends android.media.AudioRecord {
        final CountDownLatch released = new CountDownLatch(1);
        volatile boolean recording;
        FakeRecord() { super(android.media.MediaRecorder.AudioSource.MIC, 48000, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT, 3840); }
        @Override public int getState() { return STATE_INITIALIZED; }
        @Override public void startRecording() { recording = true; }
        @Override public int getRecordingState() { return recording ? RECORDSTATE_RECORDING : RECORDSTATE_STOPPED; }
        @Override public int read(byte[] b, int off, int len) {
            try { Thread.sleep(10); } catch (InterruptedException e) { return -1; }
            return len;
        }
        @Override public void stop() { recording = false; }
        @Override public void release() { recording = false; released.countDown(); }
    }

    private static boolean captureThreadAlive() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.isAlive() && "AudioBridge-Capture".equals(t.getName())) return true;
        }
        return false;
    }

    private WebSocketClient silentClient(int port, final CountDownLatch gotAudio) throws Exception {
        return new WebSocketClient(new URI("ws://127.0.0.1:" + port)) {
            @Override public void onOpen(ServerHandshake h) { }
            @Override public void onMessage(String message) { }
            @Override public void onMessage(java.nio.ByteBuffer bytes) { gotAudio.countDown(); }
            @Override public void onClose(int code, String reason, boolean remote) { }
            @Override public void onError(Exception ex) { }
        };
    }

    @Test(timeout = 20000) public void aClientIsStreamedToAndStopReleasesTheMicrophone() throws Exception {
        int port = freePort();
        final FakeRecord record = new FakeRecord();
        server = new MicStreamServer(null);
        server.useRecordFactoryForTest(bufferSize -> record);
        server.start(port);
        CountDownLatch gotAudio = new CountDownLatch(1);
        WebSocketClient client = silentClient(port, gotAudio);
        assertTrue(client.connectBlocking(5, TimeUnit.SECONDS));
        assertTrue("PCM frames reach the client", gotAudio.await(5, TimeUnit.SECONDS));
        assertTrue(server.streaming());
        assertNull(server.errorCode());

        server.stop();
        assertTrue("stop releases the microphone", record.released.await(3, TimeUnit.SECONDS));
        assertFalse(server.streaming());
        long deadline = System.currentTimeMillis() + 3000;
        while (captureThreadAlive() && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertFalse("the capture thread ended", captureThreadAlive());
    }

    @Test(timeout = 20000) public void aMicrophoneThatOpensAfterStopIsReleasedAndNeverRecords() throws Exception {
        int port = freePort();
        final FakeRecord record = new FakeRecord();
        final CountDownLatch opening = new CountDownLatch(1), mayOpen = new CountDownLatch(1);
        server = new MicStreamServer(null);
        server.useRecordFactoryForTest(bufferSize -> {
            opening.countDown();
            try { mayOpen.await(); } catch (InterruptedException ignored) { }
            return record;                 // the slow open finishes only after stop() has run
        });
        server.start(port);
        WebSocketClient client = silentClient(port, new CountDownLatch(1));
        assertTrue(client.connectBlocking(5, TimeUnit.SECONDS));
        assertTrue(opening.await(5, TimeUnit.SECONDS));

        Thread stopper = new Thread(() -> server.stop());
        stopper.start();
        Thread.sleep(300);                 // stop() has set its flag and is tearing the socket down
        mayOpen.countDown();
        stopper.join(10000);
        assertFalse("stop() returned", stopper.isAlive());

        assertTrue("the record opened too late is released", record.released.await(3, TimeUnit.SECONDS));
        assertFalse(record.recording);
        assertFalse(captureThreadAlive());
    }

    /** A client that leaves at the moment of stop() once blocked stop() for good. */
    @Test(timeout = 30000) public void stopReturnsWhileClientsAreLeaving() throws Exception {
        for (int round = 0; round < 15; round++) {
            int port = freePort();
            final MicStreamServer s = new MicStreamServer(null);
            s.useRecordFactoryForTest(bufferSize -> new FakeRecord());
            s.start(port);
            CountDownLatch gotAudio = new CountDownLatch(1);
            final WebSocketClient client = silentClient(port, gotAudio);
            assertTrue(client.connectBlocking(5, TimeUnit.SECONDS));
            assertTrue(gotAudio.await(5, TimeUnit.SECONDS));
            Thread leaver = new Thread(client::close);
            leaver.start();
            s.stop();                      // the test's timeout is the assertion
            leaver.join(2000);
        }
    }
}
