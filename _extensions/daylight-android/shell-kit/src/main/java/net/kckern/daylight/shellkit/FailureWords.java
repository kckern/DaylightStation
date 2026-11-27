package net.kckern.daylight.shellkit;

import android.content.Context;

/**
 * Why an answer from home did not come, in one of four plain lines. A slow home is not
 * "offline", and "not found" is not "isn't kept on this phone":
 *
 * - no network (Android reports no validated network): "Offline · showing what's on this phone"
 * - a timeout, a 5xx, a home that cannot be reached on a working network: "Home isn't answering"
 * - 404: "Not found at home"
 * - 401 / 403: "Home refused this phone"
 *
 * The payload classifies what went wrong ({@code reason} on its answer: timeout,
 * home-error, unreachable, not-found, refused); this side adds what only the phone knows,
 * whether it has a network, and chooses the words.
 */
public final class FailureWords {
    public enum Cause { OFFLINE, HOME_SLOW, NOT_FOUND, REFUSED, STARTING }

    public static final String OFFLINE = "Offline · showing what's on this phone";
    public static final String HOME_SLOW = "Home isn't answering";
    public static final String NOT_FOUND = "Not found at home";
    public static final String REFUSED = "Home refused this phone";

    private FailureWords() { }

    /** The cause from the payload's reason (or the error code of a failed answer) and the network. */
    public static Cause cause(String reason, boolean networkValidated) {
        String r = reason == null ? "" : reason;
        if ("starting".equals(r)) return Cause.STARTING;
        if (!networkValidated) return Cause.OFFLINE;
        switch (r) {
            case "not-found": case "not_found": return Cause.NOT_FOUND;
            case "refused": case "unauthorized": case "forbidden": return Cause.REFUSED;
            default: return Cause.HOME_SLOW;   // timeout, home-error, unreachable, unknown
        }
    }

    public static String line(Cause cause) {
        switch (cause) {
            case OFFLINE: return OFFLINE;
            case NOT_FOUND: return NOT_FOUND;
            case REFUSED: return REFUSED;
            case STARTING: return PayloadReady.STARTING;
            default: return HOME_SLOW;
        }
    }

    /** The first words only ("Offline", "Home isn't answering", …), for a line that goes on to say what shows instead. */
    public static String head(Cause cause) {
        return cause == Cause.OFFLINE ? "Offline" : line(cause);
    }

    /** Whether a Retry is worth offering: home may answer the next time. */
    public static boolean retryable(Cause cause) {
        return cause == Cause.HOME_SLOW || cause == Cause.OFFLINE;
    }

    /** The reason of an answer {ok:false, error, reason?}: its reason, else its error code. */
    public static String reasonOf(org.json.JSONObject answer) {
        if (answer == null) return "";
        String r = answer.optString("reason", "");
        return r.isEmpty() ? answer.optString("error", "") : r;
    }

    /**
     * Whether Android reports a network that reaches the internet (validated). Without
     * ACCESS_NETWORK_STATE, or when it cannot tell, true: the words then blame home, never
     * a network the phone may well have.
     */
    @android.annotation.SuppressLint("MissingPermission")
    public static boolean networkValidated(Context context) {
        try {
            android.net.ConnectivityManager cm = context.getSystemService(android.net.ConnectivityManager.class);
            if (cm == null) return true;
            android.net.NetworkCapabilities c = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return c != null && c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException unknown) {
            return true;
        }
    }
}
