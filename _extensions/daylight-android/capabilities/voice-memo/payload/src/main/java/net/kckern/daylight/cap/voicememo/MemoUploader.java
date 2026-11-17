package net.kckern.daylight.cap.voicememo;

import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Sends one memo and says what the queue should do next.
 *
 *   POST /api/v1/journalist/memo?user=<user>     Content-Type: audio/mp4
 *   X-Daylight-Memo-Id: <id>    X-Daylight-Recorded-At: <epoch ms>
 *
 *   200 with {duplicate: true|false}     accepted: the audio may be deleted
 *   400, 413, 415, 422                   refused for good: park
 *   404 (the user is not set up yet), 500, 503, any other status, a timeout
 *                                        try again; counts toward the limit
 *   no connection                        try again; does not count
 *
 * The answer arrives after the backend has transcribed the audio, saved the entry
 * and sent its reply, so the read timeout is over five minutes (BackendHttp). A
 * timeout followed by a retry is safe: the backend answers the same id as a duplicate.
 *
 * A reason is a status and the backend's own error code. Nothing of a response body
 * is kept beyond that, and nothing of the audio is read here.
 */
final class MemoUploader implements UploadPump.Sender {
    static final String IDENTITY_NOT_CONFIGURED = "identity not configured";
    static final String SITE_NOT_SET = "the household site is not set";
    /** The intake refuses a larger body with 413. */
    static final long MAX_BYTES = 26_214_400L;
    private static final Pattern ERROR_CODE = Pattern.compile("[a-z_]{1,40}");

    enum Outcome {
        UPLOADED,
        /** Try again later; the attempt counts. */
        RETRY,
        /** The backend was not reached. Try again later; the attempt does not count. */
        NO_CONNECTION,
        /** Refused for good. */
        REJECTED,
        /** Not sent, because this install is not set up to send. */
        BLOCKED,
        /** The recording is not on the phone any more. */
        LOST
    }

    static final class Result {
        final Outcome outcome;
        final String detail;

        Result(Outcome outcome, String detail) {
            this.outcome = outcome;
            this.detail = detail;
        }
    }

    private final Backend backend;
    private final Http http;

    MemoUploader(Backend backend, Http http) {
        this.backend = backend;
        this.http = http;
    }

    @Override public Result upload(MemoQueue.Memo memo) {
        // The intake needs a user and has no fallback. With none set, nothing is sent.
        String user = backend.user();
        if (user.isEmpty()) return new Result(Outcome.BLOCKED, IDENTITY_NOT_CONFIGURED);
        String url;
        try {
            url = backend.url("/api/v1/journalist/memo?user=" + URLEncoder.encode(user, "UTF-8").replace("+", "%20"));
        } catch (IllegalStateException | java.io.UnsupportedEncodingException notConfigured) {
            return new Result(Outcome.BLOCKED, SITE_NOT_SET);
        }
        File file = new File(memo.file);
        if (!file.isFile()) return new Result(Outcome.LOST, "the recording is gone");
        if (file.length() > MAX_BYTES) return new Result(Outcome.REJECTED, "too large to send");
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Daylight-Memo-Id", memo.id);
        headers.put("X-Daylight-Recorded-At", String.valueOf(memo.recordedAtMs));
        Http.Reply reply;
        try {
            reply = http.postFile(url, "audio/mp4", file, headers);
        } catch (SocketTimeoutException slow) {
            return new Result(Outcome.RETRY, "timeout");
        } catch (IOException linkDown) {
            return new Result(Outcome.NO_CONNECTION, "no connection");
        }
        if (reply.status == 200) {
            // The audio is deleted on this answer, so it has to be the intake's own. Some
            // other network's sign-in page answers 200 as well.
            return accepted(reply.body) ? new Result(Outcome.UPLOADED, "") : new Result(Outcome.RETRY, "unexpected answer");
        }
        String detail = "HTTP " + reply.status;
        int s = reply.status;
        if (s == 400 || s == 413 || s == 415 || s == 422) return new Result(Outcome.REJECTED, detail + errorCode(reply.body));
        if (s == 404 || s == 500 || s == 503) return new Result(Outcome.RETRY, detail + errorCode(reply.body));
        // Any other success is not the intake's answer either; any other failure may pass.
        return new Result(Outcome.RETRY, s > 200 && s < 300 ? "unexpected answer" : detail);
    }

    private static boolean accepted(String body) {
        try {
            return new JSONObject(body).opt("duplicate") instanceof Boolean;
        } catch (Exception notJson) {
            return false;
        }
    }

    /** " <code>" when the body is the backend's {error: "<code>"}; otherwise nothing. */
    private static String errorCode(String body) {
        try {
            Object code = new JSONObject(body).opt("error");
            return code instanceof String && ERROR_CODE.matcher((String) code).matches() ? " " + code : "";
        } catch (Exception notJson) {
            return "";
        }
    }
}
