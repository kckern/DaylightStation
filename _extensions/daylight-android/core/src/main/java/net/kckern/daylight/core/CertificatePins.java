package net.kckern.daylight.core;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A setting that pins apps to their signing certificates: "package=sha256, package=sha256".
 * Each entry names an app and the SHA-256 of the certificate it must be signed with, as
 * 64 hex characters (colons and upper case are accepted, since that is how tools print
 * a digest). Pure. Used by media.controllerPins (who may connect to the media session)
 * and car.hostPins (which car host may bind the car screen).
 *
 * The installed half reads the pins from the surface cache as a JSON object of package
 * to lower-case digest (cacheJson), since it may run before any payload is loaded.
 */
public final class CertificatePins {
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    private static final Pattern DIGEST = Pattern.compile("[0-9a-f]{64}");

    private CertificatePins() { }

    /** Null when the value is a list of pins (or empty), otherwise what is wrong. No part of the value is repeated. */
    public static String problem(String value) {
        try {
            parse(value);
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    public static Map<String, String> parse(String value) {
        Map<String, String> out = new LinkedHashMap<>();
        if (value == null) return out;
        for (String part : value.split(",")) {
            String entry = part.trim();
            if (entry.isEmpty()) continue;
            int eq = entry.indexOf('=');
            if (eq <= 0) throw new IllegalArgumentException("each entry must be package=sha256");
            String pkg = entry.substring(0, eq).trim();
            String digest = entry.substring(eq + 1).trim().replace(":", "").toLowerCase(Locale.ROOT);
            if (!PACKAGE.matcher(pkg).matches()) throw new IllegalArgumentException("an entry's package is not a package name");
            if (!DIGEST.matcher(digest).matches()) throw new IllegalArgumentException("an entry's digest must be 64 hex characters");
            if (out.put(pkg, digest) != null) throw new IllegalArgumentException("a package is pinned twice");
        }
        return out;
    }

    /** What the installed half reads: a JSON object of package to digest. */
    public static String cacheJson(String value) {
        return new JSONObject(parse(value)).toString();
    }
}
