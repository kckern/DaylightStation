package net.kckern.daylight.cap.quickinput;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Where a quick input goes. A destination is one settings line, input.dest.<n>:
 *
 *   id|label|kind|route        journal|Journal|voice|/api/v1/journalist/voice
 *
 * The kind is voice, text or photo: one destination takes one kind. The route is a path
 * on the configured backend and under /api/v1/, written as plain segments. It is never
 * an address, so no setting, link or intent can send an input to another host; the user
 * and the input's id are added when it is sent. Pure: no Android types.
 *
 * A destination exists only as one of these lines. A link or an action names one by its
 * id and nothing else.
 */
final class Destinations {
    /** What a quick input is. Each kind has one way of being captured and one size limit at the intake. */
    enum Kind {
        VOICE("voice", 26_214_400L),
        TEXT("text", 16_384L),
        PHOTO("photo", 15_728_640L);

        /** As written in a settings line, an action target and a link. */
        final String word;
        /** The intake refuses a larger body with 413. */
        final long maxBytes;

        Kind(String word, long maxBytes) {
            this.word = word;
            this.maxBytes = maxBytes;
        }

        static Kind of(String word) {
            for (Kind k : values()) if (k.word.equals(word)) return k;
            return null;
        }

        /** What the intake is told the body is. A recording says which container it is by its name. */
        String contentType(String fileName) {
            switch (this) {
                case TEXT: return "text/plain; charset=utf-8";
                case PHOTO: return "image/jpeg";
                default: return fileName != null && fileName.endsWith(".ogg") ? "audio/ogg" : "audio/mp4";
            }
        }
    }

    static final class Destination {
        final String id;
        final String label;
        final Kind kind;
        /** A path under /api/v1/ on the backend. */
        final String route;

        Destination(String id, String label, Kind kind, String route) {
            this.id = id;
            this.label = label;
            this.kind = kind;
            this.route = route;
        }
    }

    /** input.dest.1 to input.dest.8. */
    static final int SLOTS = 8;
    /** The defaults of the first slots: the table of the intake contract. */
    static final String[] DEFAULTS = {
            "journal|Journal|voice|/api/v1/journalist/voice",
            "journal-note|Journal note|text|/api/v1/journalist/text",
            "meal|Meal|voice|/api/v1/nutribot/voice",
            "meal-note|Meal note|text|/api/v1/nutribot/text",
            "meal-photo|Meal photo|photo|/api/v1/nutribot/photo",
    };
    /** What memo:new and daylight://memo/new mean: a voice input to this destination. */
    static final String MEMO_DESTINATION = "journal";

    static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");
    static final int MAX_LABEL = 25;
    static final int MAX_ROUTE = 200;
    /** Plain segments of unreserved characters under /api/v1: no escapes, no query, no trailing slash. */
    private static final Pattern ROUTE = Pattern.compile("/api/v1(/[A-Za-z0-9._~-]+)+");

    private final List<Destination> all;

    private Destinations(List<Destination> all) { this.all = Collections.unmodifiableList(all); }

    List<Destination> all() { return all; }

    Destination find(String id) {
        for (Destination d : all) if (d.id.equals(id)) return d;
        return null;
    }

    /** The prefix of a destination that takes shares from other apps (the share sheet). */
    static final String SHARE_PREFIX = "share";

    /**
     * Where something shared from another app may go: text destinations whose id is
     * "share" or starts with "share-", in slot order. The first is the default.
     */
    List<Destination> shareTargets() {
        List<Destination> out = new ArrayList<>();
        for (Destination d : all) {
            if (d.kind == Kind.TEXT && (d.id.equals(SHARE_PREFIX) || d.id.startsWith(SHARE_PREFIX + "-"))) out.add(d);
        }
        return out;
    }

    /** The label of a destination, or its id when it is not configured any more. */
    String label(String id) {
        Destination d = find(id);
        return d == null ? id : d.label;
    }

    /** What is wrong with one line, without its slot; null for an empty or a well-formed line. */
    static String problem(String raw) {
        try {
            one(raw);
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    /** lines.get(0) is input.dest.1. A line with a problem is left out and its problem added to the list. */
    static Destinations usable(List<String> lines, List<String> problems) {
        List<Destination> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < lines.size(); i++) {
            try {
                Destination d = one(lines.get(i));
                if (d == null) continue;
                if (!ids.add(d.id)) throw new IllegalArgumentException("id '" + d.id + "' is used twice");
                out.add(d);
            } catch (IllegalArgumentException e) {
                if (problems != null) problems.add("input.dest." + (i + 1) + ": " + e.getMessage());
            }
        }
        return new Destinations(out);
    }

    /** The messages never repeat the route: problems are logged. */
    private static Destination one(String raw) {
        String line = raw == null ? "" : raw.trim();
        if (line.isEmpty()) return null;
        String[] p = line.split("\\|", -1);
        if (p.length != 4) throw new IllegalArgumentException("expected id|label|kind|route");
        String id = p[0].trim(), label = p[1].trim(), kindWord = p[2].trim(), route = p[3].trim();
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("id must match [a-z][a-z0-9-]*, at most 32 characters");
        if (label.isEmpty() || label.length() > MAX_LABEL) throw new IllegalArgumentException("label must be 1 to 25 characters");
        for (int i = 0; i < label.length(); i++) {
            if (label.charAt(i) < 0x20 || label.charAt(i) == 0x7f) throw new IllegalArgumentException("label must not hold a control character");
        }
        Kind kind = Kind.of(kindWord);
        if (kind == null) throw new IllegalArgumentException("kind must be voice, text or photo");
        if (!routeOk(route)) throw new IllegalArgumentException("route must be a plain path under /api/v1/ on the backend");
        return new Destination(id, label, kind, route);
    }

    static boolean routeOk(String route) {
        if (route == null || route.length() > MAX_ROUTE || !ROUTE.matcher(route).matches()) return false;
        for (String segment : route.split("/")) {
            if (segment.equals(".") || segment.equals("..")) return false;
        }
        return true;
    }
}
