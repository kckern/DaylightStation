package net.kckern.daylight.cap.quickinput;

import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Sends one quick input and says what the queue should do next. The request is the
 * intake contract's, the same for every kind and destination:
 *
 *   POST <the destination's route>?user=<user>
 *   Content-Type: audio/ogg or audio/mp4 | text/plain; charset=utf-8 | image/jpeg
 *   X-Daylight-Device: fleet:<key>               (added to every request by BackendHttp)
 *   X-Daylight-Input-Id: <id>
 *   X-Daylight-Recorded-At: <epoch ms the input was captured; for a recording, when it STARTED>
 *   <the file, as it is>
 *
 * The route is the destination's, looked up when the input is sent: a path under
 * /api/v1/ on the configured backend (Destinations), never an address.
 *
 *   200 with {duplicate: true|false}        accepted: the audio may be deleted
 *   400, 413, 415, 422                      refused for good: park
 *   403 {ok:false, error:device_not_allowed}  this phone is not bound to the user yet:
 *                                           try again with backoff, never counted, and say so
 *   429                                     the daily allowance is used up: nothing is sent
 *                                           before the time the backend names; never counted
 *   any other answer that is the intake's own ({ok:false, error:<a code it uses>}):
 *                                           try again; counts toward the limit of 20
 *   any other answer (a proxy's page, a redirect, a sign-in page, a bare 5xx):
 *                                           try again with backoff; never counted
 *   sent, and no answer in time             try again; counts (the backend may have it)
 *   not sent (no connection, a connect timeout, the link dropped)
 *                                           try again with backoff; never counted
 *
 * Only what the backend itself said counts toward parking. A phone can be away from
 * its VPN for days, and every failure in that time is the network's, not the memo's.
 *
 * The answer arrives after the backend has transcribed the audio, saved the entry
 * and sent its reply, so the read timeout is over five minutes (BackendHttp). A
 * timeout followed by a retry is safe: the backend answers the same id as a duplicate.
 *
 * A reason is a status and the backend's own error code. Nothing of a response body
 * is kept beyond that, and nothing of the audio is read here.
 */
final class InputUploader implements UploadPump.Sender {
    static final String IDENTITY_NOT_CONFIGURED = "identity not configured";
    static final String DEVICE_NOT_CONFIGURED = "device identity not configured";
    static final String SITE_NOT_SET = "the household site is not set";
    /** The intake refuses a larger recording with 413. Each kind has its own limit (Destinations.Kind). */
    static final long MAX_BYTES = Destinations.Kind.VOICE.maxBytes;
    /** What the intake takes as X-Daylight-Device from this app. */
    private static final Pattern DEVICE = Pattern.compile("fleet:[A-Za-z0-9._-]{1,96}");
    /** The error codes the intake answers with. A body with one of them, and ok:false, is the intake's own. */
    private static final Set<String> INTAKE_ERRORS = new HashSet<>(Arrays.asList(
            "user_required", "invalid_input_id", "invalid_memo_id", "unusable_input", "empty_body", "unreadable_body", "unknown_user", "too_large",
            "unsupported_media_type", "empty_transcription", "processing_failed", "unavailable",
            "device_not_allowed", "cross_origin", "daily_limit"));
    private static final Pattern ERROR_CODE = Pattern.compile("[a-z_]{1,40}");
    static final long MIN_WAIT_MS = 60_000L;
    static final long MAX_WAIT_MS = 24 * 3_600_000L;
    /** A 429 that names no time. */
    static final long DEFAULT_WAIT_MS = 15 * 60_000L;

    enum Outcome {
        UPLOADED,
        /** Try again later; the attempt counts. */
        RETRY,
        /** An answer that is not the intake's own. Try again later; the attempt does not count. */
        RETRY_UNCOUNTED,
        /** The backend was not reached. Try again later; the attempt does not count. */
        NO_CONNECTION,
        /** The backend does not take memos from this phone for this user yet. Try again later; does not count. */
        NOT_ALLOWED,
        /** The daily allowance is used up. Nothing is sent before Result.waitMs has passed; does not count. */
        WAIT,
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
        /** For WAIT: how long before anything is sent again. */
        final long waitMs;

        Result(Outcome outcome, String detail) { this(outcome, detail, 0); }

        Result(Outcome outcome, String detail, long waitMs) {
            this.outcome = outcome;
            this.detail = detail;
            this.waitMs = waitMs;
        }
    }

    /** The destinations as configured now. Asked at every send, so a route that changed is the one used. */
    interface Routes { Destinations now(); }

    private final Backend backend;
    private final Http http;
    private final Routes routes;

    /** With the contract's default destinations. */
    InputUploader(Backend backend, Http http) {
        this(backend, http, () -> Destinations.usable(Arrays.asList(Destinations.DEFAULTS), null));
    }

    InputUploader(Backend backend, Http http, Routes routes) {
        this.backend = backend;
        this.http = http;
        this.routes = routes;
    }

    /** Why this install cannot send at all, or null. Checked before a memo is recorded, too. */
    static String blocked(Backend backend) {
        // The intake needs a user and has no fallback. With none set, nothing is sent.
        if (backend.user().isEmpty()) return IDENTITY_NOT_CONFIGURED;
        // And a device it can bind to that user: fleet:<key>.
        if (!DEVICE.matcher(backend.deviceHeader()).matches()) return DEVICE_NOT_CONFIGURED;
        return null;
    }

    /** The intake takes audio/ogg and audio/mp4; a recording says which it is by its name. */
    static String contentType(String fileName) { return Destinations.Kind.VOICE.contentType(fileName); }

    @Override public Result upload(InputQueue.Entry memo) {
        String why = blocked(backend);
        if (why != null) return new Result(Outcome.BLOCKED, why);
        // Where it goes is looked up now, by the id the entry remembers: no address is ever
        // kept in the queue, and a destination that is gone receives nothing.
        Destinations.Destination dest = routes.now().find(memo.dest);
        if (dest == null) return new Result(Outcome.REJECTED, "unknown destination");
        if (dest.kind != memo.kind) return new Result(Outcome.REJECTED, "destination does not take " + memo.kind.word);
        String url;
        try {
            url = backend.url(dest.route + "?user=" + URLEncoder.encode(backend.user(), "UTF-8").replace("+", "%20"));
        } catch (IllegalStateException | IllegalArgumentException | java.io.UnsupportedEncodingException notConfigured) {
            return new Result(Outcome.BLOCKED, SITE_NOT_SET);
        }
        File file = new File(memo.file);
        if (!file.isFile()) return new Result(Outcome.LOST, "the recording is gone");
        if (file.length() > memo.kind.maxBytes) return new Result(Outcome.REJECTED, "too large to send");
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Daylight-Input-Id", memo.id);
        // When the recording started, as kept in the queue entry: the backend files the
        // journal entry under it, however much later the upload is.
        headers.put("X-Daylight-Recorded-At", String.valueOf(memo.recordedAtMs));
        Http.Reply reply;
        try {
            reply = http.postFile(url, memo.contentType, file, headers);
        } catch (Http.NotSentException notSent) {
            return new Result(Outcome.NO_CONNECTION, "no connection");
        } catch (SocketTimeoutException sentAndNotAnswered) {
            return new Result(Outcome.RETRY, "timeout");
        } catch (IOException linkDown) {
            return new Result(Outcome.NO_CONNECTION, "no connection");
        }
        int s = reply.status;
        if (s == 200) {
            // The audio is deleted on this answer, so it has to be the intake's own. Some
            // other network's sign-in page answers 200 as well.
            return accepted(reply.body) ? new Result(Outcome.UPLOADED, "") : new Result(Outcome.RETRY_UNCOUNTED, "unexpected answer");
        }
        String code = intakeError(reply.body);
        String detail = "HTTP " + s + (code == null ? "" : " " + code);
        if (s == 400 || s == 413 || s == 415 || s == 422) return new Result(Outcome.REJECTED, "HTTP " + s + errorCode(reply.body));
        if (s == 403 && "device_not_allowed".equals(code)) return new Result(Outcome.NOT_ALLOWED, detail);
        if (s == 429) return new Result(Outcome.WAIT, detail, waitMs(reply));
        // The intake's own word (404 unknown_user, 403 cross_origin, 500 processing_failed) counts.
        if (code != null) return new Result(Outcome.RETRY, detail);
        // Anything else is some other machine's answer: a redirect, a proxy's error, a sign-in page.
        return new Result(Outcome.RETRY_UNCOUNTED, s > 200 && s < 300 ? "unexpected answer" : detail);
    }

    /** The body's retryAfterSeconds, else the Retry-After header, between a minute and a day. */
    static long waitMs(Http.Reply reply) {
        long seconds = -1;
        try {
            Object v = new JSONObject(reply.body).opt("retryAfterSeconds");
            if (v instanceof Number) seconds = ((Number) v).longValue();
        } catch (Exception notJson) {
            // The header, then.
        }
        if (seconds <= 0) {
            try {
                String header = reply.header("Retry-After");
                if (header != null) seconds = Long.parseLong(header.trim());
            } catch (NumberFormatException aDate) {
                seconds = -1;
            }
        }
        if (seconds <= 0) return DEFAULT_WAIT_MS;
        return Math.max(MIN_WAIT_MS, Math.min(seconds * 1000L, MAX_WAIT_MS));
    }

    private static boolean accepted(String body) {
        try {
            return new JSONObject(body).opt("duplicate") instanceof Boolean;
        } catch (Exception notJson) {
            return false;
        }
    }

    /** The error code when the body is the intake's own refusal ({ok:false, error:<known code>}); null otherwise. */
    private static String intakeError(String body) {
        try {
            JSONObject o = new JSONObject(body);
            Object code = o.opt("error");
            return Boolean.FALSE.equals(o.opt("ok")) && code instanceof String && INTAKE_ERRORS.contains(code) ? (String) code : null;
        } catch (Exception notJson) {
            return null;
        }
    }

    /** " <code>" when the body is {error: "<code>"}; otherwise nothing. For the reason a parked memo shows. */
    private static String errorCode(String body) {
        try {
            Object code = new JSONObject(body).opt("error");
            return code instanceof String && ERROR_CODE.matcher((String) code).matches() ? " " + code : "";
        } catch (Exception notJson) {
            return "";
        }
    }
}
