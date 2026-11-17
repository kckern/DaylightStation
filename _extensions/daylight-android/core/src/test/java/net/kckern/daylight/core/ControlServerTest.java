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
    private String base;

    @Before public void setUp() throws Exception {
        Auth auth = new Auth(TOKEN);
        Router router = new Router(auth);
        router.route("GET", "/status", req -> Router.Response.json(200, new JSONObject().put("ok", true).put("q", req.query.get("q"))));
        router.route("POST", "/echo", req -> Router.Response.json(200, new JSONObject().put("body", req.body)));
        server = new ControlServer(0, router, auth, new SocketHub("test", new StatusBoard()));
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
}
