package net.kckern.daylight.core.backend;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

public class BackendHttpTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private NanoHTTPD server;
    private String base;
    private final Map<String, String> seenHeaders = new HashMap<>();
    private volatile String seenBody;
    private volatile String seenMethod;

    @Before public void setUp() throws Exception {
        server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                seenHeaders.putAll(session.getHeaders());
                seenMethod = session.getMethod().name();
                if (session.getMethod() == Method.POST) {
                    Map<String, String> files = new HashMap<>();
                    try { session.parseBody(files); } catch (Exception e) { return newFixedLengthResponse("bad"); }
                    // NanoHTTPD keeps a body that is not a form under this key.
                    seenBody = files.get("postData");
                }
                if (session.getUri().equals("/elsewhere")) {
                    Response r = newFixedLengthResponse(Response.Status.REDIRECT, "text/plain", "");
                    r.addHeader("Location", "http://192.0.2.1:9/away");
                    return r;
                }
                Response.Status status = session.getUri().equals("/missing") ? Response.Status.NOT_FOUND : Response.Status.OK;
                return newFixedLengthResponse(status, "application/json", "{\"ok\":true}");
            }
        };
        server.start(5000, false);
        base = "http://127.0.0.1:" + server.getListeningPort();
    }

    @After public void tearDown() { server.stop(); }

    @Test public void getSendsTheDeviceHeaderAndReturnsStatusAndBody() throws Exception {
        Http http = new BackendHttp(() -> "fleet:phone");
        Http.Reply ok = http.get(base + "/api/v1/list/");
        assertEquals(200, ok.status);
        assertTrue(ok.ok());
        assertEquals("{\"ok\":true}", ok.body);
        assertEquals("fleet:phone", seenHeaders.get("x-daylight-device"));
        Http.Reply missing = http.get(base + "/missing");
        assertEquals(404, missing.status);
        assertFalse(missing.ok());
    }

    @Test public void postJsonSendsTheBody() throws Exception {
        Http.Reply r = new BackendHttp(() -> "fleet:phone").postJson(base + "/api/v1/x", "{\"a\":1}");
        assertEquals(200, r.status);
        assertEquals("POST", seenMethod);
        assertEquals("{\"a\":1}", seenBody);
        assertEquals("application/json", seenHeaders.get("content-type"));
    }

    @Test public void postFileStreamsTheFileWithItsHeaders() throws Exception {
        File f = tmp.newFile("memo.m4a");
        Files.write(f.toPath(), "not really audio".getBytes(StandardCharsets.UTF_8));
        Http http = new BackendHttp(() -> "fleet:phone");
        Http.Reply r = http.postFile(base + "/api/v1/journalist/memo", "audio/mp4", f,
                Collections.singletonMap("X-Daylight-Memo-Id", "1700000000000"));
        assertEquals(200, r.status);
        assertEquals("not really audio", seenBody);
        assertEquals("audio/mp4", seenHeaders.get("content-type"));
        assertEquals("1700000000000", seenHeaders.get("x-daylight-memo-id"));
    }

    @Test public void aRedirectIsReturnedAndNotFollowed() throws Exception {
        // A request built for the backend must not be sent on, with its headers, to
        // wherever a response points.
        Http.Reply r = new BackendHttp(() -> "fleet:phone").get(base + "/elsewhere");
        assertTrue(String.valueOf(r.status), r.status >= 300 && r.status < 400);
        assertFalse(r.ok());
    }

    @Test public void anUploadWaitsAtLeastFiveMinutesForItsAnswer() {
        // The memo intake answers after transcription and the journal save.
        assertTrue(BackendHttp.UPLOAD_READ_MS >= 5 * 60 * 1000);
    }

    // ── an upload: not sent, sent and not answered, answered ─────────────────

    private File memo() throws Exception {
        File f = tmp.newFile();
        Files.write(f.toPath(), new byte[2048]);
        return f;
    }

    @Test public void anUploadThatCannotConnectWasNotSent() throws Exception {
        int closed;
        try (java.net.ServerSocket s = new java.net.ServerSocket(0)) { closed = s.getLocalPort(); }
        try {
            new BackendHttp(() -> "fleet:phone").postFile("http://127.0.0.1:" + closed + "/api/v1/journalist/memo", "audio/ogg",
                    memo(), Collections.<String, String>emptyMap());
            fail("answered with nothing listening");
        } catch (Http.NotSentException expected) {
            // The VPN is down, the address is unreachable: the backend never saw the memo.
        }
    }

    @Test public void aConnectTimeoutIsNotSentEitherThoughItIsTheSameExceptionAsAReadTimeout() {
        java.io.IOException atConnect = BackendHttp.beforeTheBody(new java.net.SocketTimeoutException("connect timed out"));
        assertTrue(atConnect instanceof Http.NotSentException);
        assertFalse("the queue counts a SocketTimeoutException", atConnect instanceof java.net.SocketTimeoutException);
    }

    @Test public void anUploadThatWasSentAndNeverAnsweredIsATimeout() throws Exception {
        // Accepts, reads everything and says nothing: the intake, still transcribing.
        final java.net.ServerSocket quiet = new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            try (java.net.Socket s = quiet.accept()) {
                java.io.InputStream in = s.getInputStream();
                byte[] buf = new byte[4096];
                while (in.read(buf) >= 0) { /* keep reading until the client gives up */ }
            } catch (Exception ignored) { }
        });
        t.setDaemon(true);
        t.start();
        try {
            new BackendHttp(() -> "fleet:phone", 2000, 300).postFile("http://127.0.0.1:" + quiet.getLocalPort() + "/m", "audio/ogg",
                    memo(), Collections.<String, String>emptyMap());
            fail("answered");
        } catch (java.net.SocketTimeoutException expected) {
            // The body arrived, so the backend may have the memo: this one counts.
        } finally {
            quiet.close();
        }
    }

    @Test public void aReplyCarriesItsHeadersAndNoOriginIsEverSent() throws Exception {
        Http.Reply r = new BackendHttp(() -> "fleet:phone").postFile(base + "/api/v1/journalist/memo", "audio/ogg", memo(),
                Collections.singletonMap("X-Daylight-Memo-Id", "1700000000000-ab12cd34"));
        assertEquals("application/json", r.header("Content-Type"));
        assertEquals("application/json", r.header("content-type"));
        assertNull(r.header("Retry-After"));
        // The intake refuses a request that names an origin as cross-origin; a native client names none.
        assertFalse(seenHeaders.containsKey("origin"));
        assertFalse(seenHeaders.containsKey("referer"));
        assertEquals("fleet:phone", seenHeaders.get("x-daylight-device"));
    }
}
