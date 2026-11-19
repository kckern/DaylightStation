package net.kckern.daylight.cap.bookmarks;

import net.kckern.daylight.core.backend.Backend;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** The configured bookmarks, parsed from "id|label|icon|path" lines. Pure. */
final class Bookmarks {
    static final class Bookmark {
        final String id;
        final String label;
        final String icon;
        final String path;

        Bookmark(String id, String label, String icon, String path) {
            this.id = id;
            this.label = label;
            this.icon = icon;
            this.path = path;
        }
    }

    static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");
    private static final Pattern ICON = Pattern.compile("[a-z0-9_]{0,24}");
    final List<Bookmark> items;

    private Bookmarks(List<Bookmark> items) { this.items = Collections.unmodifiableList(items); }

    /** What is wrong with one line, without its slot; null for an empty or a well-formed line. */
    static String problem(String raw) {
        try {
            one(raw);
            return null;
        } catch (IllegalArgumentException e) {
            return e.getMessage();
        }
    }

    /** One line as a bookmark, null for an empty line, IllegalArgumentException for a malformed one. */
    private static Bookmark one(String raw) {
        String line = raw == null ? "" : raw.trim();
        if (line.isEmpty()) return null;
        String[] p = line.split("\\|", -1);
        if (p.length != 4) throw new IllegalArgumentException("expected id|label|icon|path");
        String id = p[0].trim(), label = p[1].trim(), icon = p[2].trim(), path = p[3].trim();
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("id must match [a-z][a-z0-9-]*, at most 32 characters");
        if (label.isEmpty() || label.length() > 40) throw new IllegalArgumentException("label must be 1 to 40 characters");
        for (int i = 0; i < label.length(); i++) {
            if (label.charAt(i) < 0x20) throw new IllegalArgumentException("label must not hold a control character");
        }
        if (!ICON.matcher(icon).matches()) throw new IllegalArgumentException("icon must be a short lower-case name");
        try {
            Backend.pagePath(path);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("path must be a page of the site, starting with a single '/' (" + e.getMessage() + ")");
        }
        return new Bookmark(id, label, icon, path);
    }

    /** lines.get(0) is bookmarks.1. Empty lines are unused slots. Throws at the first problem, naming its slot. */
    static Bookmarks parse(List<String> lines) {
        List<String> problems = new ArrayList<>();
        Bookmarks b = usable(lines, problems);
        if (!problems.isEmpty()) throw new IllegalArgumentException(problems.get(0));
        return b;
    }

    /** As parse, but a line with a problem is left out and its problem added to the list. */
    static Bookmarks usable(List<String> lines, List<String> problems) {
        List<Bookmark> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < lines.size(); i++) {
            String where = "bookmarks." + (i + 1) + ": ";
            try {
                Bookmark b = one(lines.get(i));
                if (b == null) continue;
                if (!ids.add(b.id)) throw new IllegalArgumentException("id '" + b.id + "' is used twice");
                out.add(b);
            } catch (IllegalArgumentException e) {
                problems.add(where + e.getMessage());
            }
        }
        return new Bookmarks(out);
    }

    /** True when some bookmark's path is exactly this text. */
    boolean hasPath(String path) {
        for (Bookmark b : items) if (b.path.equals(path)) return true;
        return false;
    }

    Bookmark find(String id) {
        for (Bookmark b : items) if (b.id.equals(id)) return b;
        return null;
    }
}
