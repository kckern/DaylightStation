package net.kckern.daylight.cap.mediaservice;

/**
 * Why home did not answer, as one word on the payload's answers ({@code reason}), so the
 * phone's screens can say which: a timeout or a 5xx is home not answering, a 404 is not
 * found, a 401 / 403 is home refusing this phone, and no route at all is unreachable (the
 * shell adds whether the phone has a network: shell-kit FailureWords). A slow home is
 * never reported as "offline".
 */
final class FailureReason {
    static final String TIMEOUT = "timeout", HOME_ERROR = "home-error", UNREACHABLE = "unreachable",
            NOT_FOUND = "not-found", REFUSED = "refused", BAD_REQUEST = "bad-request";

    private FailureReason() { }

    static String of(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause() == c ? null : c.getCause()) {
            if (c instanceof MediaApi.Refused) return ofStatus(((MediaApi.Refused) c).status);
            if (c instanceof java.net.SocketTimeoutException) return TIMEOUT;
            if (c instanceof java.net.UnknownHostException || c instanceof java.net.ConnectException
                    || c instanceof java.net.NoRouteToHostException) return UNREACHABLE;
            if (c instanceof IllegalArgumentException) return BAD_REQUEST;
        }
        return UNREACHABLE;
    }

    static String ofStatus(int status) {
        if (status == 404) return NOT_FOUND;
        if (status == 401 || status == 403) return REFUSED;
        if (status >= 500 || status == 408 || status == 429) return HOME_ERROR;
        return BAD_REQUEST;
    }
}
