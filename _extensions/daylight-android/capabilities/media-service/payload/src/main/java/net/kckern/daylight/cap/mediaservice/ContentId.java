package net.kckern.daylight.cap.mediaservice;

import java.util.regex.Pattern;

/**
 * The backend's content id, "<source>:<localId>". Pure.
 *
 * An id reaches this app from places it does not control: a link, a car, any media
 * browser on the phone. It is only ever turned into path segments of the backend's own
 * API (ContentPath), so what is refused here is whatever could make that path mean
 * something else: a relative or empty segment, a backslash, a control character. The
 * bar separates the two halves of a media id (MediaId) and is refused for that reason.
 */
final class ContentId {
    static final int MAX_LENGTH = 400;
    private static final Pattern SOURCE = Pattern.compile("[a-z][a-z0-9_-]{0,31}");

    private ContentId() { }

    static boolean valid(String id) {
        if (id == null || id.length() > MAX_LENGTH) return false;
        int colon = id.indexOf(':');
        if (colon <= 0 || !SOURCE.matcher(id.substring(0, colon)).matches()) return false;
        String local = id.substring(colon + 1);
        // A source alone ("plex:") is its top level.
        if (local.isEmpty()) return true;
        for (int i = 0; i < local.length(); i++) {
            char c = local.charAt(i);
            if (c < 0x20 || c == 0x7f || c == '\\' || c == '|') return false;
        }
        for (String segment : local.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return false;
            // The backend removes these segments from an id and reads them as modifiers,
            // alone or in a comma-separated segment.
            for (String part : segment.split(",", -1)) if (MODIFIERS.contains(part)) return false;
        }
        return true;
    }

    private static final java.util.Set<String> MODIFIERS = new java.util.HashSet<>(
            java.util.Arrays.asList("playable", "launchable", "shuffle", "recent_on_top", "expand"));

    static String checked(String id) {
        if (!valid(id)) throw new IllegalArgumentException("not a content id");
        return id;
    }

    /** "plex" for "plex:12345". */
    static String source(String id) { return checked(id).substring(0, id.indexOf(':')); }

    static String local(String id) { return checked(id).substring(id.indexOf(':') + 1); }
}
