package net.kckern.daylight.cap.voicememo;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.voicememo.MemoUploader.Outcome;
import net.kckern.daylight.cap.voicememo.MemoUploader.Result;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.testing.TestCore;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.file.Files;
import java.util.Map;

public class MemoUploaderTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private Backend backend;
    private int status = 200;
    private String body = "{\"ok\":true,\"duplicate\":false}";
    private IOException failure;
    private String seenUrl;
    private String seenType;
    private Map<String, String> seenHeaders;
    private int calls;

    private final Http http = new Http() {
        @Override public Reply get(String url) { throw new AssertionError("a memo is never fetched"); }
        @Override public Reply postJson(String url, String json) { throw new AssertionError("a memo is never sent as JSON"); }
        @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException {
            calls++;
            if (failure != null) throw failure;
            seenUrl = url; seenType = contentType; seenHeaders = headers;
            return new Reply(status, body);
        }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        core.settings().set(Backend.USER, "example-user");
    }

    private MemoQueue.Memo memo() throws Exception {
        File f = tmp.newFile();
        Files.write(f.toPath(), new byte[64]);
        return new MemoQueue.Memo("1700000000000-ab12cd34", f.getPath(), 1700000000000L);
    }

    private Result upload() throws Exception { return new MemoUploader(backend, http).upload(memo()); }

    @Test public void uploadsTheFileForTheConfiguredUserWithItsId() throws Exception {
        Result r = upload();
        assertEquals(Outcome.UPLOADED, r.outcome);
        assertEquals("https://kiosk.example/api/v1/journalist/memo?user=example-user", seenUrl);
        assertEquals("audio/mp4", seenType);
        assertEquals("1700000000000-ab12cd34", seenHeaders.get("X-Daylight-Memo-Id"));
        assertEquals("1700000000000", seenHeaders.get("X-Daylight-Recorded-At"));
        assertEquals(2, seenHeaders.size());
    }

    @Test public void aDuplicateAnswerIsAsGoodAsTheFirst() throws Exception {
        body = "{\"ok\":true,\"duplicate\":true}";
        assertEquals(Outcome.UPLOADED, upload().outcome);
    }

    /** The table of the intake's answers and what the queue does with each. */
    @Test public void eachAnswerOfTheIntakeHasItsAction() throws Exception {
        Object[][] table = {
                { 400, "{\"error\":\"user_required\"}", Outcome.REJECTED, "HTTP 400 user_required" },
                { 400, "{\"error\":\"invalid_memo_id\"}", Outcome.REJECTED, "HTTP 400 invalid_memo_id" },
                { 400, "{\"error\":\"empty_body\"}", Outcome.REJECTED, "HTTP 400 empty_body" },
                { 400, "{\"error\":\"unreadable_body\"}", Outcome.REJECTED, "HTTP 400 unreadable_body" },
                { 404, "{\"error\":\"unknown_user\"}", Outcome.RETRY, "HTTP 404 unknown_user" },
                { 413, "{\"error\":\"too_large\"}", Outcome.REJECTED, "HTTP 413 too_large" },
                { 415, "{\"error\":\"unsupported_media_type\"}", Outcome.REJECTED, "HTTP 415 unsupported_media_type" },
                { 422, "{\"error\":\"empty_transcription\"}", Outcome.REJECTED, "HTTP 422 empty_transcription" },
                { 500, "{\"error\":\"processing_failed\"}", Outcome.RETRY, "HTTP 500 processing_failed" },
                { 503, "{\"error\":\"unavailable\"}", Outcome.RETRY, "HTTP 503 unavailable" },
        };
        for (Object[] row : table) {
            status = (Integer) row[0];
            body = (String) row[1];
            Result r = upload();
            assertEquals(row[0] + " " + row[1], row[2], r.outcome);
            assertEquals(row[3], r.detail);
        }
    }

    @Test public void anyOtherStatusIsTriedAgainAndCounts() throws Exception {
        for (int other : new int[] { 301, 302, 401, 403, 408, 429, 502, 504 }) {
            status = other;
            body = "<html>gateway</html>";
            Result r = upload();
            assertEquals(String.valueOf(other), Outcome.RETRY, r.outcome);
            assertEquals("a page's text is never kept as a reason", "HTTP " + other, r.detail);
        }
    }

    /**
     * The audio is deleted after a 200, so a 200 must be the intake's own: a sign-in
     * page of some network the phone joined answers 200 too.
     */
    @Test public void a200ThatIsNotTheIntakesAnswerIsNotAnAcceptance() throws Exception {
        for (String notTheIntake : new String[] { "<html>Sign in</html>", "", "{}", "{\"ok\":true}", "[]", "{\"duplicate\":\"yes\"}" }) {
            body = notTheIntake;
            Result r = upload();
            assertEquals(notTheIntake, Outcome.RETRY, r.outcome);
            assertEquals("unexpected answer", r.detail);
        }
        status = 204;
        body = "";
        assertEquals(Outcome.RETRY, upload().outcome);
    }

    @Test public void aDeadLinkIsRetriedAndDoesNotCountButATimeoutDoes() throws Exception {
        failure = new IOException("no route to host");
        Result down = upload();
        assertEquals(Outcome.NO_CONNECTION, down.outcome);
        assertEquals("no connection", down.detail);
        // The answer comes after transcription. The request may have arrived, so this is an attempt.
        failure = new SocketTimeoutException("Read timed out");
        Result slow = upload();
        assertEquals(Outcome.RETRY, slow.outcome);
        assertEquals("timeout", slow.detail);
    }

    @Test public void withNoUserNothingIsSent() throws Exception {
        core.settings().set(Backend.USER, "");
        Result r = upload();
        assertEquals(Outcome.BLOCKED, r.outcome);
        assertEquals(MemoUploader.IDENTITY_NOT_CONFIGURED, r.detail);
        assertEquals("identity not configured", r.detail);
        assertEquals(0, calls);
    }

    @Test public void withNoBackendNothingIsSent() throws Exception {
        core.settings().set(Backend.BASE_URL, "");
        Result r = upload();
        assertEquals(Outcome.BLOCKED, r.outcome);
        assertEquals("the household site is not set", r.detail);
        assertEquals(0, calls);
    }

    @Test public void aRecordingThatVanishedIsLostWithoutACall() throws Exception {
        MemoQueue.Memo m = memo();
        assertTrue(new File(m.file).delete());
        Result r = new MemoUploader(backend, http).upload(m);
        assertEquals(Outcome.LOST, r.outcome);
        assertEquals(0, calls);
    }

    @Test public void aRecordingTooLargeForTheIntakeIsRefusedWithoutACall() throws Exception {
        File f = tmp.newFile();
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "rw")) { raf.setLength(MemoUploader.MAX_BYTES + 1); }
        Result r = new MemoUploader(backend, http).upload(new MemoQueue.Memo("1-a", f.getPath(), 1));
        assertEquals(Outcome.REJECTED, r.outcome);
        assertEquals("too large to send", r.detail);
        assertEquals(0, calls);
    }
}
