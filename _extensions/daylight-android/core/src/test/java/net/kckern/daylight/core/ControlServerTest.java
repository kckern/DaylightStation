package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ControlServerTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
    private ControlServer server;
    private SocketHub hub;
    private String base;

    @Before public void setUp() throws Exception {
        Auth auth = new Auth(TOKEN);
        Router router = new Router(auth);
        router.route("GET", "/status", req -> Router.Response.json(200, new JSONObject().put("ok", true).put("q", req.query.get("q"))));
        router.route("POST", "/echo", req -> Router.Response.json(200, new JSONObject().put("body", req.body)));
        router.route("PUT", "/echo", req -> Router.Response.json(200, new JSONObject().put("body", req.body)));
        router.route("DELETE", "/echo", req -> Router.Response.json(200, new JSONObject().put("body", req.body == null ? JSONObject.NULL : req.body)));
        router.route("POST", "/length", req -> Router.Response.json(200, new JSONObject().put("length", req.body.length())));
        hub = new SocketHub("test", new StatusBoard());
        server = new ControlServer(0, router, auth, hub);
        server.start(0, true);
        base = "http://127.0.0.1:" + server.getListeningPort();
    }

    @After public void tearDown() { server.stop(); }

    private static String[] http(String method, String url, String token, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        if (token != null) c.setRequestProperty("X-Daylight-Token", token);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        try (InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream()) {
            return new String[] { String.valueOf(code), new String(in.readAllBytes(), StandardCharsets.UTF_8) };
        }
    }

    @Test public void servesWithTheTokenAndPassesQueryParameters() throws Exception {
        String[] r = http("GET", base + "/status?q=hello", TOKEN, null);
        assertEquals("200", r[0]);
        assertEquals("hello", new JSONObject(r[1]).getString("q"));
    }

    @Test public void answers401WithoutTheToken() throws Exception {
        assertEquals("401", http("GET", base + "/status", null, null)[0]);
        assertEquals("401", http("GET", base + "/status", "wrong", null)[0]);
    }

    @Test public void passesAJsonBodyToTheHandler() throws Exception {
        String[] r = http("POST", base + "/echo", TOKEN, "{\"a\":1}");
        assertEquals("200", r[0]);
        assertEquals("{\"a\":1}", new JSONObject(r[1]).getString("body"));
    }

    @Test public void answers404ForAnUnknownRoute() throws Exception {
        assertEquals("404", http("GET", base + "/nope", TOKEN, null)[0]);
    }

    private String handshake(String path, String tokenHeader) throws Exception {
        try (java.net.Socket s = new java.net.Socket("127.0.0.1", server.getListeningPort())) {
            s.setSoTimeout(3000);
            String req = "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n"
                    + (tokenHeader == null ? "" : "X-Daylight-Token: " + tokenHeader + "\r\n") + "\r\n";
            s.getOutputStream().write(req.getBytes(StandardCharsets.US_ASCII));
            return new java.io.BufferedReader(new java.io.InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII)).readLine();
        }
    }

    @Test public void aWebSocketHandshakeNeedsTheTokenInTheHeaderOrTheQuery() throws Exception {
        assertTrue(handshake("/?token=" + TOKEN, null).contains(" 101 "));
        assertTrue(handshake("/", TOKEN).contains(" 101 "));
        assertTrue(handshake("/", null).contains(" 401 "));
        assertTrue(handshake("/?token=wrong", null).contains(" 401 "));
    }

    /** Sends a request head and no body, then returns the status line. Proves the server did not wait for a body. */
    private String statusLineFor(String head) throws Exception {
        try (java.net.Socket s = new java.net.Socket("127.0.0.1", server.getListeningPort())) {
            s.setSoTimeout(3000);
            s.getOutputStream().write(head.getBytes(StandardCharsets.US_ASCII));
            s.getOutputStream().flush();
            return new java.io.BufferedReader(new java.io.InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII)).readLine();
        }
    }

    @Test public void anUnauthenticatedUploadIsRefusedBeforeItsBodyIsRead() throws Exception {
        String head = "POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n"
                + "Content-Length: 500000000\r\n\r\n";
        assertTrue(statusLineFor(head).contains(" 401 "));
        assertTrue(statusLineFor(head.replace("\r\n\r\n", "\r\nX-Daylight-Token: wrong\r\n\r\n")).contains(" 401 "));
    }

    @Test public void aMalformedUnauthenticatedPostIs401Not400() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/echo").openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "multipart/form-data");   // no boundary: unparseable
        try (OutputStream o = c.getOutputStream()) { o.write("garbage".getBytes(StandardCharsets.UTF_8)); }
        assertEquals(401, c.getResponseCode());
    }

    @Test public void aBodyIsDecodedAsUtf8WhenTheContentTypeNamesNoCharset() throws Exception {
        String json = "{\"a\":\"é한\"}";
        String[] r = http("POST", base + "/echo", TOKEN, json);
        assertEquals("200", r[0]);
        assertEquals(json, new JSONObject(r[1]).getString("body"));
    }

    @Test public void putAndDeleteBodiesReachTheHandlerToo() throws Exception {
        String json = "{\"a\":\"é한\"}";
        assertEquals(json, new JSONObject(http("PUT", base + "/echo", TOKEN, json)[1]).getString("body"));
        assertEquals(json, new JSONObject(http("DELETE", base + "/echo", TOKEN, json)[1]).getString("body"));
        assertTrue(new JSONObject(http("DELETE", base + "/echo", TOKEN, null)[1]).isNull("body"));
    }

    @Test public void aMultipartBodyIsPassedThroughInsteadOfFailingToParse() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/echo").openConnection();
        c.setRequestMethod("POST");
        c.setRequestProperty("X-Daylight-Token", TOKEN);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "multipart/form-data");
        try (OutputStream o = c.getOutputStream()) { o.write("garbage".getBytes(StandardCharsets.UTF_8)); }
        assertEquals(200, c.getResponseCode());
    }

    @Test public void aBodyOverTheLimitIs413AndIsNotRead() throws Exception {
        String head = "POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Daylight-Token: " + TOKEN + "\r\n"
                + "Content-Length: " + (ControlServer.MAX_BODY_BYTES + 1) + "\r\n\r\n";
        assertTrue(statusLineFor(head).contains(" 413 "));
    }

    @Test public void aBodyOfExactlyTheLimitIsAccepted() throws Exception {
        char[] big = new char[ControlServer.MAX_BODY_BYTES];
        java.util.Arrays.fill(big, 'x');
        String[] r = http("POST", base + "/length", TOKEN, new String(big));
        assertEquals("200", r[0]);
        assertEquals(ControlServer.MAX_BODY_BYTES, new JSONObject(r[1]).getInt("length"));
    }

    @Test public void aContentLengthThatIsNotANumberIs400() throws Exception {
        String head = "POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Daylight-Token: " + TOKEN + "\r\nContent-Length: lots\r\n\r\n";
        assertTrue(statusLineFor(head).contains(" 400 "));
    }

    @Test public void theConnectionStaysUsableAfterARefusedSmallBody() throws Exception {
        // A wrong token with a small body: the body is discarded, so the next request on the socket parses.
        try (java.net.Socket s = new java.net.Socket("127.0.0.1", server.getListeningPort())) {
            s.setSoTimeout(3000);
            String first = "POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Daylight-Token: wrong\r\nContent-Length: 7\r\n\r\n{\"a\":1}";
            String second = "GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Daylight-Token: " + TOKEN + "\r\n\r\n";
            s.getOutputStream().write((first + second).getBytes(StandardCharsets.US_ASCII));
            java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII));
            String line = in.readLine();
            assertTrue(line, line.contains(" 401 "));
            String next;
            // The first response's body has no trailing newline, so the second status line follows it on one line.
            do { next = in.readLine(); } while (next != null && !next.contains("HTTP/1.1 "));
            assertNotNull("the second request got no answer", next);
            assertTrue(next, next.contains(" 200 "));
        }
    }

    /**
     * POST /kiosk/load waits for a page, up to webview.loadTimeoutSec. The read timeout
     * bounds how long the server waits for the CLIENT to send; a handler that takes
     * longer than it to answer must still be answered on the same connection.
     */
    @Test public void aHandlerSlowerThanTheReadTimeoutStillAnswers() throws Exception {
        Auth auth = new Auth(TOKEN);
        Router router = new Router(auth);
        final long handlerMs = ControlServer.SOCKET_READ_TIMEOUT_MS + 1500L;
        router.route("POST", "/slow", req -> {
            Thread.sleep(handlerMs);
            return Router.Response.json(200, new JSONObject().put("ok", true).put("body", req.body));
        });
        ControlServer started = ControlServer.startWithRetry(() -> new ControlServer(0, router), 1);
        assertNotNull(started);
        try {
            long began = System.currentTimeMillis();
            String[] r = http("POST", "http://127.0.0.1:" + started.getListeningPort() + "/slow", TOKEN, "{\"url\":\"https://kiosk.example/\"}");
            assertEquals("200", r[0]);
            assertTrue(new JSONObject(r[1]).getBoolean("ok"));
            assertEquals("{\"url\":\"https://kiosk.example/\"}", new JSONObject(r[1]).getString("body"));
            assertTrue("the handler really outlasted the read timeout",
                    System.currentTimeMillis() - began >= handlerMs);
        } finally {
            started.stop();
        }
    }

    @Test public void aConnectionThatSendsNothingIsClosedAfterTheReadTimeout() throws Exception {
        assertEquals(5000, ControlServer.SOCKET_READ_TIMEOUT_MS);
        Auth auth = new Auth(TOKEN);
        ControlServer started = ControlServer.startWithRetry(() -> new ControlServer(0, new Router(auth)), 1);
        assertNotNull(started);
        try (java.net.Socket s = new java.net.Socket("127.0.0.1", started.getListeningPort())) {
            // Longer than the server's timeout: a server with none would leave this read waiting.
            s.setSoTimeout(9000);
            s.getOutputStream().write("GET /status HT".getBytes(StandardCharsets.US_ASCII));
            s.getOutputStream().flush();
            long began = System.currentTimeMillis();
            // The server gives up on the half-sent request: it answers or closes, either way the read returns.
            s.getInputStream().read();
            assertTrue(System.currentTimeMillis() - began < 8500);
        } finally {
            started.stop();
        }
    }

    /**
     * A real socket whose peer completes the WebSocket handshake and then never reads.
     * Its receive window fills, the server's write to it blocks, and the hub must go on
     * serving everyone else and then cut it off.
     */
    @Test(timeout = 30000) public void aSocketPeerThatNeverReadsIsCutOffWithoutBlockingBroadcasts() throws Exception {
        try (java.net.Socket peer = new java.net.Socket()) {
            peer.setReceiveBufferSize(4096);
            peer.connect(new java.net.InetSocketAddress("127.0.0.1", server.getListeningPort()));
            String req = "GET /?token=" + TOKEN + " HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
            peer.getOutputStream().write(req.getBytes(StandardCharsets.US_ASCII));
            long deadline = System.currentTimeMillis() + 5000;
            while (hub.clients() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertEquals(1, hub.clients());

            // 64 KiB a frame: a few of them fill the socket buffers, the rest fill the queue.
            StringBuilder big = new StringBuilder("{\"type\":\"status\",\"pad\":\"");
            for (int i = 0; i < 65536; i++) big.append('x');
            String frame = big.append("\"}").toString();
            long slowest = 0;
            for (int i = 0; i < SocketHub.MAX_QUEUED + 200 && hub.clients() > 0; i++) {
                long t0 = System.nanoTime();
                hub.broadcast(frame);
                slowest = Math.max(slowest, System.nanoTime() - t0);
            }
            assertTrue("a broadcast never waits for the peer (slowest " + slowest / 1_000_000 + " ms)", slowest < 500_000_000L);
            deadline = System.currentTimeMillis() + 5000;
            while (hub.clients() > 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertEquals("the peer that stopped reading is gone", 0, hub.clients());

            // The server is still answering.
            assertEquals("200", http("GET", base + "/status", TOKEN, null)[0]);
        }
    }
}
