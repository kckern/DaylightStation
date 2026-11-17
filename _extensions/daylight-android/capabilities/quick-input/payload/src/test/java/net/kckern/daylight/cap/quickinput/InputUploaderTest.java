package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.InputUploader.Outcome;
import net.kckern.daylight.cap.quickinput.InputUploader.Result;
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

public class InputUploaderTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private Backend backend;
    private int status = 200;
    private String body = "{\"ok\":true,\"duplicate\":false}";
    private IOException failure;
    private Map<String, String> replyHeaders;
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
            return new Reply(status, body, replyHeaders);
        }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        core.settings().set(Backend.USER, "example-user");
    }

    private InputQueue.Memo memo() throws Exception {
        File f = tmp.newFile();
        Files.write(f.toPath(), new byte[64]);
        return new InputQueue.Memo("1700000000000-ab12cd34", f.getPath(), 1700000000000L);
    }

    private Result upload() throws Exception { return new InputUploader(backend, http).upload(memo()); }

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
                { 400, "{\"ok\":false,\"error\":\"user_required\"}", Outcome.REJECTED, "HTTP 400 user_required" },
                { 400, "{\"ok\":false,\"error\":\"invalid_memo_id\"}", Outcome.REJECTED, "HTTP 400 invalid_memo_id" },
                { 400, "{\"ok\":false,\"error\":\"empty_body\"}", Outcome.REJECTED, "HTTP 400 empty_body" },
                { 400, "{\"ok\":false,\"error\":\"unreadable_body\"}", Outcome.REJECTED, "HTTP 400 unreadable_body" },
                { 413, "{\"ok\":false,\"error\":\"too_large\"}", Outcome.REJECTED, "HTTP 413 too_large" },
                { 413, "<html>Request Entity Too Large</html>", Outcome.REJECTED, "HTTP 413" },
                { 415, "{\"ok\":false,\"error\":\"unsupported_media_type\"}", Outcome.REJECTED, "HTTP 415 unsupported_media_type" },
                // Answered again on a retry, without transcribing: it never changes.
                { 422, "{\"ok\":false,\"error\":\"empty_transcription\"}", Outcome.REJECTED, "HTTP 422 empty_transcription" },
                // The intake's own word, so each of these counts toward the limit of twenty.
                { 404, "{\"ok\":false,\"error\":\"unknown_user\"}", Outcome.RETRY, "HTTP 404 unknown_user" },
                { 403, "{\"ok\":false,\"error\":\"cross_origin\"}", Outcome.RETRY, "HTTP 403 cross_origin" },
                { 500, "{\"ok\":false,\"error\":\"processing_failed\"}", Outcome.RETRY, "HTTP 500 processing_failed" },
                { 503, "{\"ok\":false,\"error\":\"unavailable\"}", Outcome.RETRY, "HTTP 503 unavailable" },
                // The owner has not bound this phone to the user yet: not the memo's fault.
                { 403, "{\"ok\":false,\"error\":\"device_not_allowed\"}", Outcome.NOT_ALLOWED, "HTTP 403 device_not_allowed" },
                { 429, "{\"ok\":false,\"error\":\"daily_limit\",\"limit\":\"memos\",\"retryAfterSeconds\":7200}", Outcome.WAIT, "HTTP 429 daily_limit" },
        };
        for (Object[] row : table) {
            status = (Integer) row[0];
            body = (String) row[1];
            Result r = upload();
            assertEquals(row[0] + " " + row[1], row[2], r.outcome);
            assertEquals(row[3], r.detail);
        }
    }

    /**
     * Off the VPN, or behind some other network's gateway, every answer is some other
     * machine's. None of them says anything about the memo, so none counts toward parking.
     */
    @Test public void anAnswerThatIsNotTheIntakesOwnIsTriedAgainAndNeverCounts() throws Exception {
        for (int other : new int[] { 301, 302, 401, 403, 404, 408, 500, 502, 503, 504 }) {
            for (String notTheIntake : new String[] { "<html>gateway</html>", "", "{\"error\":\"unknown_user\"}",
                    "{\"ok\":false,\"error\":\"something_else\"}", "{\"ok\":true,\"error\":\"unknown_user\"}" }) {
                status = other;
                body = notTheIntake;
                Result r = upload();
                assertEquals(other + " " + notTheIntake, Outcome.RETRY_UNCOUNTED, r.outcome);
                assertEquals("a page's text is never kept as a reason", "HTTP " + other, r.detail);
            }
        }
    }

    // ── the daily allowance ──────────────────────────────────────────────────

    private long waitFor(String answer, String retryAfterHeader) throws Exception {
        status = 429;
        body = answer;
        replyHeaders = retryAfterHeader == null ? null : java.util.Collections.singletonMap("Retry-After", retryAfterHeader);
        Result r = upload();
        assertEquals(Outcome.WAIT, r.outcome);
        return r.waitMs;
    }

    @Test public void theDailyLimitSaysHowLongToWaitInItsBodyOrElseItsHeader() throws Exception {
        String limit = "{\"ok\":false,\"error\":\"daily_limit\",\"limit\":\"bytes\"";
        assertEquals(7_200_000L, waitFor(limit + ",\"retryAfterSeconds\":7200}", "60"));
        assertEquals("the header, when the body names no time", 1_800_000L, waitFor(limit + "}", "1800"));
        assertEquals("never under a minute", 60_000L, waitFor(limit + ",\"retryAfterSeconds\":1}", null));
        assertEquals("never over a day", 86_400_000L, waitFor(limit + ",\"retryAfterSeconds\":999999}", null));
        assertEquals(86_400_000L, waitFor(limit + "}", "172800"));
        assertEquals("no time at all", InputUploader.DEFAULT_WAIT_MS, waitFor(limit + "}", null));
        assertEquals("a date in the header is not read", InputUploader.DEFAULT_WAIT_MS, waitFor("<html>slow down</html>", "Wed, 21 Oct 2026 07:28:00 GMT"));
    }

    // ── what is sent ─────────────────────────────────────────────────────────

    @Test public void theRecordedAtHeaderIsWhenTheRecordingStartedAsKeptInTheQueueEntry() throws Exception {
        File f = tmp.newFile("1700000000000-ab12cd34.ogg");
        Files.write(f.toPath(), new byte[64]);
        // Queued long ago, uploaded now: the header is neither the file's time nor the clock's.
        InputQueue.Memo recovered = new InputQueue.Memo("1700000000000-ab12cd34", f.getPath(), 1700000000000L);
        assertEquals(Outcome.UPLOADED, new InputUploader(backend, http).upload(recovered).outcome);
        assertEquals("1700000000000", seenHeaders.get("X-Daylight-Recorded-At"));
        assertEquals("an Ogg recording is sent as what it is", "audio/ogg", seenType);
        assertEquals("audio/mp4", InputUploader.contentType("1700000000000-ab12cd34-00@1700000000000.m4a"));
    }

    @Test public void withADeviceIdentityTheIntakeCannotBindNothingIsSent() throws Exception {
        core.settings().set(Backend.DEVICE, "browser:example-tablet");
        Result r = upload();
        assertEquals(Outcome.BLOCKED, r.outcome);
        assertEquals("device identity not configured", r.detail);
        assertEquals(0, calls);
        core.settings().set(Backend.DEVICE, "fleet:example-phone");
        assertEquals(Outcome.UPLOADED, upload().outcome);
        core.settings().set(Backend.DEVICE, "");
        assertEquals("the default is fleet:<device id>", Outcome.UPLOADED, upload().outcome);
    }

    /**
     * The audio is deleted after a 200, so a 200 must be the intake's own: a sign-in
     * page of some network the phone joined answers 200 too.
     */
    @Test public void a200ThatIsNotTheIntakesAnswerIsNotAnAcceptance() throws Exception {
        for (String notTheIntake : new String[] { "<html>Sign in</html>", "", "{}", "{\"ok\":true}", "[]", "{\"duplicate\":\"yes\"}" }) {
            body = notTheIntake;
            Result r = upload();
            assertEquals(notTheIntake, Outcome.RETRY_UNCOUNTED, r.outcome);
            assertEquals("unexpected answer", r.detail);
        }
        status = 204;
        body = "";
        assertEquals(Outcome.RETRY_UNCOUNTED, upload().outcome);
    }

    @Test public void aDeadLinkIsRetriedAndDoesNotCountButATimeoutDoes() throws Exception {
        failure = new IOException("no route to host");
        Result down = upload();
        assertEquals(Outcome.NO_CONNECTION, down.outcome);
        assertEquals("no connection", down.detail);
        // Off the VPN the private address does not answer: a connect timeout. The body
        // never left, so this is the link's failure, however many hours it lasts.
        failure = new Http.NotSentException(new SocketTimeoutException("connect timed out"));
        Result unreachable = upload();
        assertEquals(Outcome.NO_CONNECTION, unreachable.outcome);
        assertEquals("no connection", unreachable.detail);
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
        assertEquals(InputUploader.IDENTITY_NOT_CONFIGURED, r.detail);
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
        InputQueue.Memo m = memo();
        assertTrue(new File(m.file).delete());
        Result r = new InputUploader(backend, http).upload(m);
        assertEquals(Outcome.LOST, r.outcome);
        assertEquals(0, calls);
    }

    @Test public void aRecordingTooLargeForTheIntakeIsRefusedWithoutACall() throws Exception {
        File f = tmp.newFile();
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "rw")) { raf.setLength(InputUploader.MAX_BYTES + 1); }
        Result r = new InputUploader(backend, http).upload(new InputQueue.Memo("1-a", f.getPath(), 1));
        assertEquals(Outcome.REJECTED, r.outcome);
        assertEquals("too large to send", r.detail);
        assertEquals(0, calls);
    }
}
