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
}
