package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

public class ShellServerTest {
    static final String TOKEN = "0123456789abcdef0123456789abcdef";
    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static final String[][] ROUTES = {
        { "GET", "/" }, { "GET", "/status" }, { "GET", "/payload" }, { "POST", "/payload" },
        { "POST", "/payload/rollback" }, { "POST", "/restart" }, { "GET", "/log" }, { "GET", "/nope" },
        { "DELETE", "/payload" }, { "GET", "/restart" },
    };

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private LoaderHarness h;
    private PayloadLoader loader;

    private final ShellServer.Host host = new ShellServer.Host() {
        @Override public PayloadLoader loaderOrNull() { return loader; }
        @Override public int versionCode() { return 3; }
    };

    @Before public void setUp() throws Exception {
        h = new LoaderHarness(tmp.newFolder("payloads"));
        loader = h.loader("3");
        loader.boot().get(5, TimeUnit.SECONDS);
    }

    private ShellServer server() { return new ShellServer(host, 0, TOKEN); }

    private static JSONObject body(ShellServer.Reply r) throws Exception { return new JSONObject(r.body); }

    @Test public void everyRouteAnswers401WithoutTheTokenOrWithAWrongOne() throws Exception {
        for (boolean ready : new boolean[] { true, false }) {
            PayloadLoader keep = loader;
            if (!ready) loader = null;
            for (String[] route : ROUTES) {
                for (String presented : new String[] { null, "", "wrong", TOKEN + "x", TOKEN.substring(1) }) {
                    ShellServer.Reply r = server().handle(route[0], route[1], presented, "http://192.0.2.10/p.jar", SHA);
                    assertEquals(route[0] + " " + route[1] + " with token " + presented, 401, r.status);
                    assertEquals("unauthorized", body(r).getString("error"));
                    assertFalse(body(r).getBoolean("ok"));
                }
            }
            loader = keep;
        }
        assertEquals("a refused request must not reach the loader", 1, h.opened.size());
        assertTrue(h.shell.notes.toString(), !h.shell.notes.toString().contains("fetch"));
    }

    @Test public void aServerBuiltWithoutATokenRefusesEveryone() throws Exception {
        ShellServer open = new ShellServer(host, 0, "");
        assertEquals(401, open.handle("GET", "/status", "", null, null).status);
        assertEquals(401, open.handle("GET", "/status", null, null, null).status);
    }

    @Test public void statusAnswersWithTheToken() throws Exception {
        ShellServer.Reply r = server().handle("GET", "/status", TOKEN, null, null);
        assertEquals(200, r.status);
        assertEquals(3, body(r).getInt("versionCode"));
        assertEquals("p0-baked-v3.jar", body(r).getJSONObject("payload").getString("active"));
    }

    @Test public void rollbackWithNoPreviousIs409() throws Exception {
        ShellServer.Reply r = server().handle("POST", "/payload/rollback", TOKEN, null, null);
        assertEquals(409, r.status);
        assertFalse(body(r).getBoolean("ok"));
        assertEquals("no previous payload", body(r).getString("error"));
    }

    @Test public void restartWithNoCurrentPayloadIs409() throws Exception {
        LoaderHarness empty = new LoaderHarness(tmp.newFolder("empty"));
        empty.baked = null;
        loader = empty.loader("3");
        loader.boot().get(5, TimeUnit.SECONDS);
        ShellServer.Reply r = server().handle("POST", "/restart", TOKEN, null, null);
        assertEquals(409, r.status);
        assertEquals("no current payload", body(r).getString("error"));
    }

    @Test public void aSwapWithAShortShaIs409() throws Exception {
        ShellServer.Reply r = server().handle("POST", "/payload", TOKEN, "http://192.0.2.10/p.jar", "abc123");
        assertEquals(409, r.status);
        assertFalse(body(r).getBoolean("ok"));
        assertTrue(body(r).getString("error").contains("sha256"));
    }

    @Test public void anAcceptedActionIs200WithTheResult() throws Exception {
        ShellServer.Reply r = server().handle("POST", "/restart", TOKEN, null, null);
        assertEquals(200, r.status);
        assertTrue(body(r).getBoolean("ok"));
        assertTrue(body(r).getString("result").startsWith("accepted: "));
        loader.awaitIdle(5000);
    }

    @Test public void theGateStatusesStillApply() throws Exception {
        assertEquals(400, server().handle("POST", "/payload", TOKEN, null, null).status);
        assertEquals(405, server().handle("GET", "/restart", TOKEN, null, null).status);
        assertEquals(404, server().handle("GET", "/nope", TOKEN, null, null).status);
        loader = null;
        assertEquals(503, server().handle("POST", "/restart", TOKEN, null, null).status);
        assertEquals(200, server().handle("GET", "/status", TOKEN, null, null).status);
    }

    @Test public void theStatusesReachARealHttpClient() throws Exception {
        ShellServer server = server();
        server.start(5000, true);
        try {
            String base = "http://127.0.0.1:" + server.getListeningPort();
            HttpURLConnection refused = (HttpURLConnection) new URL(base + "/payload/rollback").openConnection();
            refused.setRequestMethod("POST");
            refused.setRequestProperty("X-Daylight-Token", TOKEN);
            assertEquals(409, refused.getResponseCode());
            HttpURLConnection anonymous = (HttpURLConnection) new URL(base + "/payload/rollback").openConnection();
            anonymous.setRequestMethod("POST");
            assertEquals(401, anonymous.getResponseCode());
            HttpURLConnection ok = (HttpURLConnection) new URL(base + "/payload").openConnection();
            ok.setRequestProperty("X-Daylight-Token", TOKEN);
            assertEquals(200, ok.getResponseCode());
        } finally {
            server.stop();
        }
    }
}
