package net.kckern.daylight.core.kiosk;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Web origins, for every place the kiosk decides whether to trust a URL: the page
 * bridge, the mic and camera grants, and the URLs POST /sound may fetch. Pure Java.
 * Parsing is by hand and strict: anything doubtful has no origin, and no origin is never trusted.
 */
public final class Origins {
    private Origins() { }

    /** "scheme://host[:port]" with default ports dropped, or null. http and https only. */
    public static String of(String url) {
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

    /** The origins in a comma-separated list of origins or URLs. Parts that have no origin are skipped. */
    public static Set<String> list(String commaSeparated) {
        Set<String> out = new LinkedHashSet<>();
        if (commaSeparated == null) return out;
        for (String part : commaSeparated.split(",")) {
            String o = of(part.trim());
            if (o != null) out.add(o);
        }
        return out;
    }
}
