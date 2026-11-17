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
        Router router = new Router(new Auth(TOKEN));
        router.route("GET", "/status", req -> Router.Response.json(200, new JSONObject().put("ok", true).put("q", req.query.get("q"))));
        router.route("POST", "/echo", req -> Router.Response.json(200, new JSONObject().put("body", req.body)));
        server = new ControlServer(0, router);
        server.start(5000, false);
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
}
