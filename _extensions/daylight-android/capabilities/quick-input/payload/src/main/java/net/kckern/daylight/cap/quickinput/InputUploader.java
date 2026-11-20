package net.kckern.daylight.cap.quickinput;

import net.kckern.daylight.cap.quickinput.shell.CaptureScope;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
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
 *   200 with a matching receipt            accepted: the capture may be deleted
 *   400, 413, 415, 422 with intake error    refused for good: park
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
    private static final String LEGACY_MEMO_ROUTE = "/api/v1/journalist/memo";
    static final long MIN_WAIT_MS = 60_000L;
    static final long MAX_WAIT_MS = 24 * 3_600_000L;
    /** A 429 that names no time. */
    static final long DEFAULT_WAIT_MS = 15 * 60_000L;

    enum Outcome {
        OTHER_OWNER,
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

    static String currentScope(Backend backend) {
        try {
            Backend.SiteUser pair = backend.siteUser();
            return CaptureScope.key(pair.origin, pair.user);
        } catch (IllegalStateException | LinkageError unavailable) {
            // A payload can also run on an installed shell from before scoped capture.
            return null;
        }
    }

    static boolean allowsFile(File file, String owner) {
        try {
            return CaptureScope.allowsFile(file, owner);
        } catch (LinkageError olderShell) {
            File directory = file.getParentFile();
            return directory == null || !directory.getName().startsWith(CaptureScope.DIRECTORY_PREFIX);
        }
    }

    @Override public Result upload(InputQueue.Entry memo) {
        String why = blocked(backend);
        if (why != null) return new Result(Outcome.BLOCKED, why);
        Backend.SiteUser pair;
        try {
            pair = backend.siteUser();
        } catch (IllegalStateException notConfigured) {
            return new Result(Outcome.BLOCKED, SITE_NOT_SET);
        }
        File file = new File(memo.file);
        String owner = null;
        try { owner = CaptureScope.key(pair.origin, pair.user); } catch (LinkageError olderShell) { }
        if (!allowsFile(file, owner)) {
            return new Result(Outcome.OTHER_OWNER, "waiting for the capture's household and user");
        }
        // Destination and URL are resolved only for the binding that passed the check.
        Destinations.Destination dest = routes.now().find(memo.dest);
        if (dest == null) return new Result(Outcome.REJECTED, "unknown destination");
        if (dest.kind != memo.kind) return new Result(Outcome.REJECTED, "destination does not take " + memo.kind.word);
        String url;
        try {
            url = pair.origin + Backend.checkedPath(dest.route + "?user=" + URLEncoder.encode(pair.user, "UTF-8").replace("+", "%20"));
        } catch (IllegalArgumentException | java.io.UnsupportedEncodingException notConfigured) {
            return new Result(Outcome.BLOCKED, SITE_NOT_SET);
        }
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
            // Only a receipt for this capture permits the pump to delete its file.
            return accepted(reply.body, memo.id, LEGACY_MEMO_ROUTE.equals(dest.route))
                    ? new Result(Outcome.UPLOADED, "")
                    : new Result(Outcome.RETRY_UNCOUNTED, "unexpected answer");
        }
        String code = intakeError(s, reply.body);
        String detail = "HTTP " + s + (code == null ? "" : " " + code);
        if (code != null && (s == 400 || s == 413 || s == 415 || s == 422)) {
            return new Result(Outcome.REJECTED, detail);
        }
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

    private static boolean accepted(String body, String expectedId, boolean legacyMemoRoute) {
        try {
            JSONObject receipt = IntakeJson.parse(body);
            Object id = receipt.opt("inputId");
            if (legacyMemoRoute && !receipt.has("inputId")) id = receipt.opt("memoId");
            return Boolean.TRUE.equals(receipt.opt("ok"))
                    && receipt.opt("duplicate") instanceof Boolean
                    && expectedId.equals(id);
        } catch (JSONException notJson) {
            return false;
        }
    }

    /** The intake's own refusal, identified by the documented status and error code. */
    private static String intakeError(int status, String body) {
        try {
            JSONObject response = IntakeJson.parse(body);
            if (!Boolean.FALSE.equals(response.opt("ok"))) return null;
            Object error = response.opt("error");
            if (!(error instanceof String)) return null;
            String code = (String) error;
            switch (code) {
                case "user_required":
                case "invalid_input_id":
                case "invalid_memo_id":
                case "empty_body":
                case "unreadable_body":
                    return status == 400 ? code : null;
                case "device_not_allowed":
                case "cross_origin":
                    return status == 403 ? code : null;
                case "unknown_user":
                    return status == 404 ? code : null;
                case "too_large":
                    return status == 413 ? code : null;
                case "unsupported_media_type":
                    return status == 415 ? code : null;
                case "empty_transcription":
                case "unusable_input":
                    return status == 422 ? code : null;
                case "daily_limit":
                    return status == 429 ? code : null;
                case "processing_failed":
                    return status == 500 ? code : null;
                case "unavailable":
                    return status == 503 ? code : null;
                default:
                    return null;
            }
        } catch (JSONException notJson) {
            return null;
        }
    }

}
