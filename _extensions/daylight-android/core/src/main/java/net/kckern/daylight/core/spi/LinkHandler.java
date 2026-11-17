package net.kckern.daylight.core.spi;

import org.json.JSONObject;

import java.util.Map;

/**
 * Provided by each capability that owns a kind of daylight:// link ("open", "bookmark",
 * "action", "memo", "media"). The `notifications` capability parses and checks a link,
 * then hands it to the handler of its kind; with no handler in the build the link
 * answers "not available on this device".
 */
public interface LinkHandler {
    /** The link kind, lower case. */
    String kind();

    /**
     * Perform the link.
     *
     * @param arg   the path after the kind, without its leading slash; empty when absent
     * @param query the decoded query parameters. The install key is never among them.
     * @return a {@link net.kckern.daylight.core.LinkEffect}
     * @throws IllegalArgumentException when the link names something that does not exist
     *         or is not allowed; the caller answers 400 and nothing is opened
     */
    JSONObject handle(String arg, Map<String, String> query) throws Exception;

    /**
     * Perform a link that arrived from outside the app (the link activity, POST /link).
     *
     * @param keyed whether the link carried this install's key. A link without it can
     *              come from any app or web page on the device; a handler that opens a
     *              page holds such a link to less. A kind that is honoured only with the
     *              key always sees true. The two-argument form is a call from inside
     *              the app (a one-tap action running its target) and is trusted.
     */
    default JSONObject handle(String arg, Map<String, String> query, boolean keyed) throws Exception {
        return handle(arg, query);
    }
}
