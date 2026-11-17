package net.kckern.daylight.core.backend;

import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.kiosk.Origins;

import java.util.regex.Pattern;

/**
 * Where the backend is and who is asking. The three settings are declared by the
 * first capability that calls from(); a build with no such capability never sees them.
 *
 *   backend.baseUrl   the backend's origin. Empty: the origin of webview.startUrl.
 *   identity.user     the household user this install acts for. Empty: not configured.
 *   identity.device   sent as X-Daylight-Device. Empty: "fleet:<device id>".
 *
 * None is a secret, and none is written in a device file: an address or a name is a
 * {placeholder} resolved from the private file when the payload is built.
 */
public final class Backend {
    public static final String BASE_URL = "backend.baseUrl";
    public static final String USER = "identity.user";
    public static final String DEVICE = "identity.device";
    private static final String START_URL = "webview.startUrl";

    /** What the backend accepts as X-Daylight-Device. */
    private static final Pattern DEVICE_ID = Pattern.compile("(fleet|browser):[A-Za-z0-9._-]{1,96}");
    /** A user name goes into a query string; it is held to what needs no escaping. */
    private static final Pattern USER_NAME = Pattern.compile("[A-Za-z0-9._-]{1,64}");

    private final SettingsRegistry settings;
    private final String deviceId;

    private Backend(SettingsRegistry settings, String deviceId) {
        this.settings = settings;
        this.deviceId = deviceId;
    }

    public static Backend from(CoreContext core) { return from(core.settings(), core.deviceId()); }

    public static Backend from(SettingsRegistry s, String deviceId) {
        declareOnce(s, BASE_URL, value -> ((String) value).isEmpty() || Origins.of((String) value) != null
                ? null : "'" + BASE_URL + "' is not an http(s) URL");
        declareOnce(s, USER, value -> ((String) value).isEmpty() || USER_NAME.matcher((String) value).matches()
                ? null : "'" + USER + "' must be 1 to 64 letters, digits, '.', '_' or '-'");
        declareOnce(s, DEVICE, value -> ((String) value).isEmpty() || DEVICE_ID.matcher((String) value).matches()
                ? null : "'" + DEVICE + "' must be fleet:<id> or browser:<id>");
        return new Backend(s, deviceId);
    }

    private static void declareOnce(SettingsRegistry s, String key, SettingsRegistry.Rule rule) {
        synchronized (s) {
            try { s.get(key); }
            catch (SettingsRegistry.UnknownSettingException absent) { s.declare(key, SettingsRegistry.Type.STRING, "", rule); }
        }
    }

    /** True when a base can be worked out. A capability checks this at start and says so once when it cannot. */
    public boolean configured() {
        try { baseUrl(); return true; } catch (IllegalStateException e) { return false; }
    }

    /** scheme://host[:port], from backend.baseUrl or else from webview.startUrl. */
    public String baseUrl() {
        String explicit = (String) settings.get(BASE_URL);
        if (!explicit.isEmpty()) return origin(explicit);
        String start;
        try { start = (String) settings.get(START_URL); }
        catch (SettingsRegistry.UnknownSettingException noWebview) { start = ""; }
        if (start.isEmpty()) throw new IllegalStateException("backend not configured: set backend.baseUrl");
        return origin(start);
    }

    private static String origin(String url) {
        String origin = Origins.of(url);
        // The value is not echoed: it can be a private address.
        if (origin == null) throw new IllegalStateException("the backend base is not an http(s) URL");
        return origin;
    }

    /** An absolute URL for a backend path. The path must start with exactly one '/'. */
    public String url(String path) {
        return baseUrl() + checkedPath(path);
    }

    /**
     * A path on the backend, or IllegalArgumentException. One leading slash, no
     * backslash and no control character: nothing a URL parser could read as another host.
     */
    public static String checkedPath(String path) {
        if (path == null || !path.startsWith("/") || path.startsWith("//") || path.indexOf('\\') >= 0) {
            throw new IllegalArgumentException("path must start with a single '/'");
        }
        for (int i = 0; i < path.length(); i++) {
            if (path.charAt(i) < 0x20 || path.charAt(i) == 0x7f) throw new IllegalArgumentException("path contains a control character");
        }
        return path;
    }

    /** A media or image reference made absolute, or null when it points anywhere but the backend. */
    public String absolute(String ref) {
        if (ref == null || ref.isEmpty()) return null;
        if (ref.startsWith("/")) {
            try { return baseUrl() + checkedPath(ref); } catch (IllegalArgumentException elsewhere) { return null; }
        }
        // Compared as origins: a prefix test would accept a host that only starts like the backend.
        return baseUrl().equals(Origins.of(ref)) ? ref : null;
    }

    /** The household user this install acts for. Empty when unset. */
    public String user() { return (String) settings.get(USER); }

    /** Sent as X-Daylight-Device. A fleet id must be a key in the household devices.yml. */
    public String deviceHeader() {
        String d = (String) settings.get(DEVICE);
        return d.isEmpty() ? "fleet:" + deviceId : d;
    }
}
