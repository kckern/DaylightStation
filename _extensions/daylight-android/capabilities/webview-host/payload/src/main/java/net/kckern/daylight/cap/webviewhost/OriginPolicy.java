package net.kckern.daylight.cap.webviewhost;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Which page origins get the bridge, the mic and the camera. Pure Java.
 * Parsing is by hand and strict: anything doubtful has no origin, and no origin is never allowed.
 */
final class OriginPolicy {
    private final Set<String> origins;

    private OriginPolicy(Set<String> origins) { this.origins = origins; }

    /** bridgeOrigins: comma-separated origins or URLs. Empty means the origin of startUrl. */
    static OriginPolicy fromSettings(String bridgeOrigins, String startUrl) {
        Set<String> out = new LinkedHashSet<>();
        if (bridgeOrigins != null) {
            for (String part : bridgeOrigins.split(",")) {
                String o = originOf(part.trim());
                if (o != null) out.add(o);
            }
        }
        if (out.isEmpty()) {
            String o = originOf(startUrl);
            if (o != null) out.add(o);
        }
        return new OriginPolicy(Collections.unmodifiableSet(out));
    }

    boolean allows(String url) {
        String o = originOf(url);
        return o != null && origins.contains(o);
    }

    /** The origins, in the form AndroidX allowedOriginRules expects ("https://host[:port]"). */
    Set<String> rules() { return origins; }

    /** "scheme://host[:port]" with default ports dropped, or null. http and https only. */
    static String originOf(String url) {
        if (url == null) return null;
        String s = url.trim();
        int sep = s.indexOf("://");
        if (sep <= 0) return null;
        String scheme = s.substring(0, sep).toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        String rest = s.substring(sep + 3);
        int end = rest.length();
        for (char stop : new char[] { '/', '?', '#' }) {
            int i = rest.indexOf(stop);
            if (i >= 0 && i < end) end = i;
        }
        String authority = rest.substring(0, end);
        if (authority.isEmpty()) return null;
        String host = authority;
        int port = -1;
        int colon = authority.lastIndexOf(':');
        if (colon >= 0) {
            host = authority.substring(0, colon);
            String p = authority.substring(colon + 1);
            if (p.isEmpty() || p.length() > 5) return null;
            for (int i = 0; i < p.length(); i++) if (!Character.isDigit(p.charAt(i))) return null;
            port = Integer.parseInt(p);
            if (port < 1 || port > 65535) return null;
        }
        if (host.isEmpty()) return null;
        // Letters, digits, dot and hyphen only. That excludes user-info ('@'), backslashes,
        // spaces and bracketed IPv6 literals; none of them is a household app origin.
        for (int i = 0; i < host.length(); i++) {
            char c = host.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-';
            if (!ok) return null;
        }
        boolean defaultPort = port == -1 || (scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443);
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (defaultPort ? "" : ":" + port);
    }
}
