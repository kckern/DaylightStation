package net.kckern.daylight.cap.onetap;

import net.kckern.daylight.core.backend.Backend;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The configured one-tap actions, parsed from "id|label|icon|target" lines. Pure.
 *
 *   open:/path          a page of the household site, in the web view
 *   bookmark:<id>       a configured bookmark
 *   memo:new            start a voice memo: the earlier name of input:voice:journal
 *   input:<kind>:<dest> a quick input (voice, text or photo) to a configured destination
 *   media:<contentId>   play natively
 *   api:/api/...        an empty POST to that backend path, and a message with the outcome
 *
 * An action exists only as one of these lines in the device's settings. Nothing that
 * arrives in a link, an intent or from a page can add one or change what one does.
 */
final class ActionCatalog {
    enum Kind { OPEN, BOOKMARK, MEMO, INPUT, MEDIA, API }

    static final class Action {
        final String id;
        final String label;
        final String icon;
        final Kind kind;
        /** Page path, bookmark id, "new", "<input kind>:<destination id>", content id or API path, by kind. */
        final String value;

        Action(String id, String label, String icon, Kind kind, String value) {
            this.id = id;
            this.label = label;
            this.icon = icon;
            this.kind = kind;
            this.value = value;
        }

        /** The link kind of the capability that performs this action, or null for an API call. */
        String linkKind() {
            switch (kind) {
                case OPEN: return "open";
                case BOOKMARK: return "bookmark";
                case MEMO: return "memo";
                case INPUT: return "input";
                case MEDIA: return "media";
                default: return null;
            }
        }

        /** The argument that capability's link handler expects. */
        String linkArg() {
            switch (kind) {
                case BOOKMARK: case MEMO: return value;
                case INPUT: return value.substring(0, value.indexOf(':'));
                case MEDIA: return "play";
                default: return "";
            }
        }

        /** The query that capability's link handler expects. */
        Map<String, String> linkQuery() {
            Map<String, String> query = new LinkedHashMap<>();
            if (kind == Kind.OPEN) query.put("path", value);
            if (kind == Kind.MEDIA) query.put("id", value);
            if (kind == Kind.INPUT) query.put("to", value.substring(value.indexOf(':') + 1));
            return query;
        }
    }

    static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");
    private static final Pattern ICON = Pattern.compile("[a-z0-9_]{0,24}");
    /** <source>:<local id>, as the backend's content ids are written. */
    private static final Pattern CONTENT_ID = Pattern.compile("[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._/-]{1,200}");
    /** An API path: segments of unreserved characters, and an optional plain query. */
    private static final Pattern API_PATH = Pattern.compile("/api(/[A-Za-z0-9._~-]+)+/?(\\?[A-Za-z0-9._~&=,:-]*)?");
    /** What a quick input is, and the id of where it goes. Whether that destination exists is the quick-input capability's to say. */
    private static final Pattern INPUT = Pattern.compile("(voice|text|photo):[a-z][a-z0-9-]{0,31}");
    private final List<Action> actions;

    private ActionCatalog(List<Action> actions) { this.actions = Collections.unmodifiableList(actions); }

    List<Action> all() { return actions; }

    Action find(String id) {
        for (Action a : actions) if (a.id.equals(id)) return a;
        return null;
    }

    /**
     * This catalog and the pinned media actions after it. A pinned action whose id a
     * configured action already has is left out: the settings line wins.
     */
    ActionCatalog withPinned(PinnedMedia pinned) {
        List<Action> out = new ArrayList<>(actions);
        for (PinnedMedia.Entry e : pinned.all()) {
            if (find(e.id) == null) out.add(new Action(e.id, e.label, "play", Kind.MEDIA, e.contentId));
        }
        return new ActionCatalog(out);
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

    /** lines.get(0) is actions.1. Empty lines are unused slots. Throws at the first problem, naming its slot. */
    static ActionCatalog parse(List<String> lines) {
        List<String> problems = new ArrayList<>();
        ActionCatalog c = usable(lines, problems);
        if (!problems.isEmpty()) throw new IllegalArgumentException(problems.get(0));
        return c;
    }

    /** As parse, but a line with a problem is left out and its problem added to the list. */
    static ActionCatalog usable(List<String> lines, List<String> problems) {
        List<Action> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < lines.size(); i++) {
            String where = "actions." + (i + 1) + ": ";
            try {
                Action a = one(lines.get(i));
                if (a == null) continue;
                if (!ids.add(a.id)) throw new IllegalArgumentException("id '" + a.id + "' is used twice");
                out.add(a);
            } catch (IllegalArgumentException e) {
                problems.add(where + e.getMessage());
            }
        }
        return new ActionCatalog(out);
    }

    private static Action one(String raw) {
        String line = raw == null ? "" : raw.trim();
        if (line.isEmpty()) return null;
        String[] p = line.split("\\|", -1);
        if (p.length != 4) throw new IllegalArgumentException("expected id|label|icon|target");
        String id = p[0].trim(), label = p[1].trim(), icon = p[2].trim(), target = p[3].trim();
        if (!ID.matcher(id).matches()) throw new IllegalArgumentException("id must match [a-z][a-z0-9-]*, at most 32 characters");
        if (label.isEmpty() || label.length() > 25) throw new IllegalArgumentException("label must be 1 to 25 characters");
        for (int i = 0; i < label.length(); i++) {
            if (label.charAt(i) < 0x20) throw new IllegalArgumentException("label must not hold a control character");
        }
        if (!ICON.matcher(icon).matches()) throw new IllegalArgumentException("icon must be a short lower-case name");
        return target(id, label, icon, target);
    }

    /** The messages never repeat the target: it can be a private path, and problems are logged. */
    private static Action target(String id, String label, String icon, String target) {
        int colon = target.indexOf(':');
        String scheme = colon < 0 ? "" : target.substring(0, colon);
        String rest = colon < 0 ? "" : target.substring(colon + 1);
        switch (scheme) {
            case "open":
                try { Backend.pagePath(rest); }
                catch (IllegalArgumentException e) { throw new IllegalArgumentException("open: needs a page of the site, starting with a single '/'"); }
                return new Action(id, label, icon, Kind.OPEN, rest);
            case "bookmark":
                if (!ID.matcher(rest).matches()) throw new IllegalArgumentException("bookmark: needs a bookmark id");
                return new Action(id, label, icon, Kind.BOOKMARK, rest);
            case "memo":
                if (!"new".equals(rest)) throw new IllegalArgumentException("memo: only 'new' is supported");
                return new Action(id, label, icon, Kind.MEMO, rest);
            case "input":
                if (!INPUT.matcher(rest).matches()) throw new IllegalArgumentException("input: needs voice, text or photo and a destination id");
                return new Action(id, label, icon, Kind.INPUT, rest);
            case "media":
                if (!CONTENT_ID.matcher(rest).matches()) throw new IllegalArgumentException("media: needs a content id such as plex:12345");
                return new Action(id, label, icon, Kind.MEDIA, rest);
            case "api":
                if (!rest.startsWith("/api/")) throw new IllegalArgumentException("api: path must start with /api/");
                if (!API_PATH.matcher(rest).matches() || rest.contains("/../") || rest.contains("/./") || rest.endsWith("/..") || rest.endsWith("/.")) {
                    throw new IllegalArgumentException("api: path must be plain segments under /api/");
                }
                return new Action(id, label, icon, Kind.API, rest);
            default:
                throw new IllegalArgumentException("unknown target; use open:, bookmark:, memo:, input:, media: or api:");
        }
    }
}
