package net.kckern.daylight.cap.notifications;

import net.kckern.daylight.core.kiosk.Origins;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A parsed link. Pure: no Android types. Two forms are links:
 *
 *   daylight://<kind>[/<arg>][?<query>]     kind: open, bookmark, action, memo, media
 *   http(s)://<an allowed origin>/<path>    read as daylight://open for that path
 *
 * Everything else is refused, and so is a web link on any other origin. Every link
 * is untrusted input: the link activity is exported, so any app or web page on the
 * device can send one. A refusal's message is one of a few fixed sentences and never
 * repeats any part of the link, because it is written to a log that leaves the device.
 */
public final class DeepLink {
    public static final String SCHEME = "daylight";
    static final int MAX_LENGTH = 4096;
    private static final Set<String> KINDS = new HashSet<>(Arrays.asList("open", "bookmark", "action", "memo", "media"));
    /** Kinds that change something. They are honoured only with this install's key. */
    private static final Set<String> KEYED = new HashSet<>(Arrays.asList("action", "memo"));
    private static final String KEY_PARAM = "k";

    public final String kind;
    /** The path after the kind, without the leading slash. Empty when absent. */
    public final String arg;
    public final Map<String, String> query;

    private DeepLink(String kind, String arg, Map<String, String> query) {
        this.kind = kind;
        this.arg = arg;
        this.query = Collections.unmodifiableMap(query);
    }

    /** @param webOrigins the origins ("scheme://host[:port]") whose web links may open in the app */
    public static DeepLink parse(String raw, Set<String> webOrigins) {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("the link is empty");
        if (raw.length() > MAX_LENGTH) throw new IllegalArgumentException("the link is too long");
        String s = raw.trim();
        String lower = s.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http:") || lower.startsWith("https:")) return web(s, webOrigins);

        URI u;
        try { u = URI.create(s); }
        catch (IllegalArgumentException e) { throw new IllegalArgumentException("the link is not a URI"); }
        if (u.getScheme() == null || !SCHEME.equals(u.getScheme().toLowerCase(Locale.ROOT))) {
            throw new IllegalArgumentException("the link has a scheme this app does not open");
        }
        if (u.getUserInfo() != null || u.getPort() != -1) throw new IllegalArgumentException("the link is malformed");
        String kind = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        if (!KINDS.contains(kind)) throw new IllegalArgumentException("the link is of a kind this app does not know");
        String path = u.getPath() == null ? "" : u.getPath();
        String arg = path.startsWith("/") ? path.substring(1) : path;
        Map<String, String> query = new LinkedHashMap<>();
        String rawQuery = u.getRawQuery();
        if (rawQuery != null) {
            for (String pair : rawQuery.split("&")) {
                if (pair.isEmpty()) continue;
                int eq = pair.indexOf('=');
                String name = eq < 0 ? pair : pair.substring(0, eq);
                String value = eq < 0 ? "" : pair.substring(eq + 1);
                query.put(decode(name), decode(value));
            }
        }
        return new DeepLink(kind, arg, query);
    }

    /** A web link is an open link for its path, and only on an origin the app was told about. */
    private static DeepLink web(String s, Set<String> webOrigins) {
        String origin = Origins.of(s);
        if (origin == null || webOrigins == null || !webOrigins.contains(origin)) {
            throw new IllegalArgumentException("the link is not for this app's site");
        }
        String rest = s.substring(s.indexOf("://") + 3);
        int at = rest.length();
        for (char stop : new char[] { '/', '?', '#' }) {
            int i = rest.indexOf(stop);
            if (i >= 0 && i < at) at = i;
        }
        String path = rest.substring(at);
        if (!path.startsWith("/")) path = "/" + path;
        Map<String, String> query = new LinkedHashMap<>();
        // Kept as written. The capability that opens pages checks the path's shape itself.
        query.put("path", path);
        return new DeepLink("open", "", query);
    }

    public boolean needsKey() { return KEYED.contains(kind); }

    public boolean authorized(String installKey) {
        if (!needsKey()) return true;
        String presented = query.get(KEY_PARAM);
        if (installKey == null || installKey.length() < 32 || presented == null) return false;
        return MessageDigest.isEqual(installKey.getBytes(StandardCharsets.UTF_8), presented.getBytes(StandardCharsets.UTF_8));
    }

    /** The query the owning capability receives: everything but the key. */
    public Map<String, String> handlerQuery() {
        Map<String, String> out = new LinkedHashMap<>(query);
        out.remove(KEY_PARAM);
        return out;
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception malformed) {
            throw new IllegalArgumentException("the link has a malformed escape");
        }
    }
}
